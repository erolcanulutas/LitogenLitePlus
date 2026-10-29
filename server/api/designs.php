<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * Holder designs kept in an account.
 *
 * A design is the holder's settings and what is on its frame, as the page
 * sends it — a small piece of JSON. It never holds the picture: that stays in
 * the browser, and nothing here could take it.
 *
 * GET lists the signed-in person's designs. POST saves one under a name, or
 * deletes one.
 */

const MAX_DESIGNS = 50;
const MAX_BYTES = 60000;

$db = db();
$user = current_user($db);

if (!$user) {
    fail('Sign in first', 401);
}

$id = (int) $user['id'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $q = $db->prepare('SELECT name, data, updated_at FROM holder_designs WHERE user_id = ? ORDER BY updated_at DESC');
    $q->execute([$id]);

    $out = [];
    foreach ($q->fetchAll() as $row) {
        $data = json_decode((string) $row['data'], true);
        if (is_array($data)) {
            $out[] = ['name' => $row['name'], 'data' => $data, 'updatedAt' => $row['updated_at']];
        }
    }
    reply(['ok' => true, 'designs' => $out]);
}

require_post();

$in = body();
$action = (string) ($in['action'] ?? 'save');
$name = trim((string) ($in['name'] ?? ''));

if ($name === '' || strlen($name) > 240) {
    fail('Give the design a name of up to 80 characters');
}

if ($action === 'delete') {
    $db->prepare('DELETE FROM holder_designs WHERE user_id = ? AND name = ?')->execute([$id, $name]);
    reply(['ok' => true]);
}

if ($action !== 'save') {
    fail('Unknown action');
}

$data = $in['data'] ?? null;
if (!is_array($data)) {
    fail('Nothing to save');
}

$json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false || strlen($json) > MAX_BYTES) {
    fail('That design is too large to keep');
}

$have = $db->prepare('SELECT COUNT(*) FROM holder_designs WHERE user_id = ? AND name <> ?');
$have->execute([$id, $name]);
if ((int) $have->fetchColumn() >= MAX_DESIGNS) {
    fail('You have ' . MAX_DESIGNS . ' saved designs; delete one first');
}

$now = gmdate('Y-m-d H:i:s');
$update = $db->prepare('UPDATE holder_designs SET data = ?, updated_at = ? WHERE user_id = ? AND name = ?');
$update->execute([$json, $now, $id, $name]);

if ($update->rowCount() === 0) {
    $db->prepare('INSERT INTO holder_designs (user_id, name, data, updated_at) VALUES (?, ?, ?, ?)')
       ->execute([$id, $name, $json, $now]);
}

reply(['ok' => true]);
