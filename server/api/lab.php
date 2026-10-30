<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * The home page's lab: where the models and pictures on the front page are made
 * and kept, and the templates with them.
 *
 * Temporary, and for the owner only: nothing here does anything unless the
 * signed-in address is one named under 'lab_admins' in litogen-config.php. With
 * none named, the lab is shut.
 *
 * What it writes is ordinary files under /home/ in the web root, which the front
 * page reads like any other: models/slot-N.stl, models/manifest.json listing
 * them, the pictures, and lab/ for the designs they were made from and the
 * templates.
 */

const SLOTS = 12;
const MAX_STL = 6 * 1024 * 1024;
const MAX_PICTURE = 5 * 1024 * 1024;

$db = db();
$user = current_user($db);
$admins = array_map('strtolower', (array) (config()['lab_admins'] ?? []));
$isAdmin = $user && in_array(strtolower((string) $user['email']), $admins, true);

$home = dirname(__DIR__) . '/home';

/** A folder under /home/, made if it is not there. */
function lab_dir(string $home, string $sub): string
{
    $dir = $home . '/' . $sub;
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail('Could not make a folder', 500);
    }
    return $dir;
}

/** Reads a JSON file, or gives an empty list. */
function lab_read(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

/** Writes a JSON file whole, holding a lock so two saves cannot interleave. */
function lab_write(string $path, array $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if (file_put_contents($path, $json, LOCK_EX) === false) {
        fail('Could not write a file', 500);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    reply(['ok' => true, 'admin' => $isAdmin]);
}

require_post();

if (!$isAdmin) {
    fail($user ? 'Not allowed' : 'Sign in first', $user ? 403 : 401);
}

$in = body();
$action = (string) ($in['action'] ?? '');

$models = lab_dir($home, 'models');
$labdir = lab_dir($home, 'lab');
$manifestPath = $models . '/manifest.json';
$templatesPath = $labdir . '/templates.json';

function slot_of(array $in): int
{
    $slot = (int) ($in['slot'] ?? 0);
    if ($slot < 1 || $slot > SLOTS) {
        fail('Unknown slot');
    }
    return $slot;
}

if ($action === 'list') {
    reply([
        'ok' => true,
        'models' => lab_read($manifestPath),
        'templates' => lab_read($templatesPath),
    ]);
}

if ($action === 'design') {
    $slot = slot_of($in);
    reply(['ok' => true, 'design' => lab_read($labdir . "/slot-$slot.design.json") ?: null]);
}

if ($action === 'save_model') {
    $slot = slot_of($in);
    $caption = mb_substr(trim((string) ($in['caption'] ?? '')), 0, 60);
    $stl = base64_decode((string) ($in['stl'] ?? ''), true);
    if ($stl === false || strlen($stl) < 84 || strlen($stl) > MAX_STL) {
        fail('That model is empty or too large');
    }

    // A binary STL is an 80-byte header, a count, and 50 bytes a triangle.
    $count = unpack('V', substr($stl, 80, 4))[1];
    if (84 + 50 * $count !== strlen($stl)) {
        fail('That is not a binary STL');
    }

    $design = $in['design'] ?? null;
    if (is_array($design) && strlen((string) json_encode($design)) < 200000) {
        lab_write($labdir . "/slot-$slot.design.json", $design);
    }
    if (file_put_contents($models . "/slot-$slot.stl", $stl, LOCK_EX) === false) {
        fail('Could not write the model', 500);
    }

    $list = array_values(array_filter(lab_read($manifestPath), static fn($m) => (int) ($m['slot'] ?? 0) !== $slot));
    $color = (string) ($in['color'] ?? '');
    $list[] = [
        'slot' => $slot,
        'file' => "models/slot-$slot.stl",
        'caption' => $caption !== '' ? $caption : "Model $slot",
        'color' => preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : '#d9b77a',
        'updated' => gmdate('Y-m-d H:i:s'),
    ];
    usort($list, static fn($a, $b) => $a['slot'] <=> $b['slot']);
    lab_write($manifestPath, $list);
    reply(['ok' => true, 'models' => $list]);
}

if ($action === 'delete_model') {
    $slot = slot_of($in);
    @unlink($models . "/slot-$slot.stl");
    @unlink($labdir . "/slot-$slot.design.json");
    $list = array_values(array_filter(lab_read($manifestPath), static fn($m) => (int) ($m['slot'] ?? 0) !== $slot));
    lab_write($manifestPath, $list);
    reply(['ok' => true, 'models' => $list]);
}

if ($action === 'save_template') {
    $name = mb_substr(trim((string) ($in['name'] ?? '')), 0, 60);
    $items = $in['items'] ?? null;
    if ($name === '' || !is_array($items) || count($items) === 0 || strlen((string) json_encode($items)) > 100000) {
        fail('That template is empty or too large');
    }
    $list = lab_read($templatesPath);
    $list[] = ['id' => 't' . bin2hex(random_bytes(4)), 'name' => $name, 'items' => $items, 'updated' => gmdate('Y-m-d H:i:s')];
    lab_write($templatesPath, $list);
    reply(['ok' => true, 'templates' => $list]);
}

if ($action === 'delete_template') {
    $id = (string) ($in['id'] ?? '');
    $list = array_values(array_filter(lab_read($templatesPath), static fn($t) => ($t['id'] ?? '') !== $id));
    lab_write($templatesPath, $list);
    reply(['ok' => true, 'templates' => $list]);
}

if ($action === 'upload_picture') {
    $name = (string) ($in['name'] ?? '');
    if (!preg_match('/^(hero-[1-5]|model-[1-9])\.jpg$/', $name)) {
        fail('Unknown picture');
    }
    $bytes = base64_decode((string) ($in['data'] ?? ''), true);
    if ($bytes === false || strlen($bytes) < 100 || strlen($bytes) > MAX_PICTURE || substr($bytes, 0, 3) !== "\xFF\xD8\xFF") {
        fail('That is not a JPEG, or it is too large');
    }
    if (file_put_contents($home . '/' . $name, $bytes, LOCK_EX) === false) {
        fail('Could not write the picture', 500);
    }
    reply(['ok' => true, 'name' => $name]);
}

fail('Unknown action');
