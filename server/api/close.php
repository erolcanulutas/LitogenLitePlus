<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * Closing an account, and meaning it.
 *
 * Everything goes: the account, the ways of signing into it, and the record of
 * what it spent. What stays is the row saying a payment was handled, with no
 * name attached — without it the same webhook delivered again would look new,
 * and a refund we could not match to anything would be worse than a line in a
 * table.
 *
 * The address has to be typed to confirm. A password would not do it: an
 * account made through Google has none, and this is the one action with no way
 * back.
 */

require_post();

$db = db();
$user = current_user($db);

if (!$user) {
    fail('Sign in first', 401);
}

$typed = strtolower(trim((string) (body()['email'] ?? '')));
if ($typed !== strtolower((string) $user['email'])) {
    fail('That is not the address on this account');
}

$id = (int) $user['id'];

$db->prepare('DELETE FROM identities WHERE user_id = ?')->execute([$id]);
$db->prepare('DELETE FROM token_ledger WHERE user_id = ?')->execute([$id]);
$db->prepare('DELETE FROM pending_credits WHERE email = ?')->execute([$user['email']]);
$db->prepare('UPDATE payments SET email = ? WHERE email = ?')->execute(['', $user['email']]);
$db->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);

begin_session();
$_SESSION = [];
session_destroy();

reply(['ok' => true]);
