<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

$user = current_user(db());

reply([
    'ok' => true,
    'user' => $user ? ['email' => $user['email'], 'plan' => $user['plan']] : null,
]);
