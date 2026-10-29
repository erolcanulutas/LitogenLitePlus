<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * The colours of filament an account has said it owns.
 *
 * A short list of #rrggbb colours the page uses to print in the nearest of
 * them. GET returns it; POST replaces it.
 */

const MAX_FILAMENTS = 12;

$db = db();
$user = current_user($db);

if (!$user) {
    fail('Sign in first', 401);
}

$id = (int) $user['id'];

/**
 * A list as it may have been kept or sent: each a colour and whether it is
 * ticked, or, from before ticking existed, a bare colour, which is unticked.
 */
function tidy(mixed $in): array
{
    $out = [];
    foreach (is_array($in) ? $in : [] as $item) {
        $c = is_array($item) ? ($item['c'] ?? null) : $item;
        $on = is_array($item) && ($item['on'] ?? false) === true;
        if (is_string($c) && preg_match('/^#[0-9a-fA-F]{6}$/', $c) === 1) {
            $out[] = ['c' => strtolower($c), 'on' => $on];
        }
        if (count($out) >= MAX_FILAMENTS) {
            break;
        }
    }
    return $out;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $q = $db->prepare('SELECT colors FROM user_filaments WHERE user_id = ?');
    $q->execute([$id]);
    reply(['ok' => true, 'filaments' => tidy(json_decode((string) ($q->fetchColumn() ?: '[]'), true))]);
}

require_post();

$in = body()['filaments'] ?? null;
if (!is_array($in)) {
    fail('Nothing to save');
}

$clean = tidy($in);
$json = json_encode($clean);
$now = gmdate('Y-m-d H:i:s');
$update = $db->prepare('UPDATE user_filaments SET colors = ?, updated_at = ? WHERE user_id = ?');
$update->execute([$json, $now, $id]);

if ($update->rowCount() === 0) {
    $have = $db->prepare('SELECT COUNT(*) FROM user_filaments WHERE user_id = ?');
    $have->execute([$id]);
    if ((int) $have->fetchColumn() === 0) {
        $db->prepare('INSERT INTO user_filaments (user_id, colors, updated_at) VALUES (?, ?, ?)')
           ->execute([$id, $json, $now]);
    }
}

reply(['ok' => true, 'filaments' => $clean]);
