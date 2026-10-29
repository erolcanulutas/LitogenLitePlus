<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * Paying for one export.
 *
 * Asked for before the file is handed over, never before a preview: looking at
 * a model costs nothing, keeping one costs a token. A subscription costs
 * nothing per export and this says so rather than quietly taking one anyway.
 */

require_post();

$db = db();
$user = current_user($db);

if (!$user) {
    fail('Sign in first', 401);
}

if (subscribed($user)) {
    reply(['ok' => true, 'spent' => 0, 'user' => account_shape($user)]);
}

// A holder is paid for once. Its fingerprint says which design it is, and an
// account that has paid for that one downloads it again for nothing. The
// receipt is written first, so two requests at once cannot both pay: whichever
// loses the unique index finds it already there.
$ref = (string) (body()['ref'] ?? '');
$ref = preg_match('/^[0-9a-f]{16,64}$/', $ref) === 1 ? $ref : '';
$receipt = false;

if ($ref !== '') {
    try {
        $db->prepare('INSERT INTO export_receipts (user_id, ref, created_at) VALUES (?, ?, ?)')
           ->execute([$user['id'], $ref, gmdate('Y-m-d H:i:s')]);
        $receipt = true;
    } catch (PDOException) {
        reply(['ok' => true, 'spent' => 0, 'again' => true, 'user' => account_shape($user)]);
    }
}

// One statement, so two exports started at the same moment cannot both read a
// balance of one and both be allowed. The condition is what makes it safe;
// reading the balance first and writing it back afterwards would not be.
$take = $db->prepare('UPDATE users SET tokens = tokens - 1 WHERE id = ? AND tokens > 0');
$take->execute([$user['id']]);

if ($take->rowCount() !== 1) {
    if ($receipt) {
        $db->prepare('DELETE FROM export_receipts WHERE user_id = ? AND ref = ?')->execute([$user['id'], $ref]);
    }
    fail('No tokens left', 402);
}

note_tokens($db, (int) $user['id'], -1, 'export');

$fresh = current_user($db);
reply(['ok' => true, 'spent' => 1, 'user' => $fresh ? account_shape($fresh) : null]);
