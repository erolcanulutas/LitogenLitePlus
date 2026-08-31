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

// One statement, so two exports started at the same moment cannot both read a
// balance of one and both be allowed. The condition is what makes it safe;
// reading the balance first and writing it back afterwards would not be.
$take = $db->prepare('UPDATE users SET tokens = tokens - 1 WHERE id = ? AND tokens > 0');
$take->execute([$user['id']]);

if ($take->rowCount() !== 1) {
    fail('No tokens left', 402);
}

note_tokens($db, (int) $user['id'], -1, 'export');

$fresh = current_user($db);
reply(['ok' => true, 'spent' => 1, 'user' => $fresh ? account_shape($fresh) : null]);
