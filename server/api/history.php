<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * Past work kept in an account: the settings of the picture's model, the image
 * editor's crop and paint, and the frame with its candle stand, as JSON the page
 * sends. Never the picture itself, which stays on the person's own computer.
 *
 * GET lists the signed-in person's entries, newest first. POST saves one under
 * an id the page makes, or deletes one.
 */

const MAX_ENTRIES = 50;
const MAX_BYTES = 600000;

$db = db();
$user = current_user($db);

if (!$user) {
    fail('Sign in first', 401);
}

$id = (int) $user['id'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $q = $db->prepare('SELECT entry_id, data, updated_at FROM work_history WHERE user_id = ? ORDER BY updated_at DESC');
    $q->execute([$id]);

    $out = [];
    foreach ($q->fetchAll() as $row) {
        $data = json_decode((string) $row['data'], true);
        if (is_array($data)) {
            $out[] = ['id' => $row['entry_id'], 'data' => $data];
        }
    }
    reply(['ok' => true, 'entries' => $out]);
}

require_post();

$in = body();
$action = (string) ($in['action'] ?? 'save');
$entry = (string) ($in['id'] ?? '');

if (!preg_match('/^[a-f0-9]{8,40}$/', $entry)) {
    fail('Unknown entry');
}

if ($action === 'delete') {
    $db->prepare('DELETE FROM work_history WHERE user_id = ? AND entry_id = ?')->execute([$id, $entry]);
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
    fail('That is too large to keep');
}

$now = gmdate('Y-m-d H:i:s');
$update = $db->prepare('UPDATE work_history SET data = ?, updated_at = ? WHERE user_id = ? AND entry_id = ?');
$update->execute([$json, $now, $id, $entry]);

if ($update->rowCount() === 0) {
    $db->prepare('INSERT INTO work_history (user_id, entry_id, data, updated_at) VALUES (?, ?, ?, ?)')
       ->execute([$id, $entry, $json, $now]);
}

// Only the newest are kept.
$old = $db->prepare('SELECT entry_id FROM work_history WHERE user_id = ? ORDER BY updated_at DESC');
$old->execute([$id]);
$ids = $old->fetchAll(PDO::FETCH_COLUMN);
foreach (array_slice($ids, MAX_ENTRIES) as $drop) {
    $db->prepare('DELETE FROM work_history WHERE user_id = ? AND entry_id = ?')->execute([$id, $drop]);
}

reply(['ok' => true]);
