<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

$user = current_user(db());

reply([
    'ok' => true,
    'user' => $user ? account_shape($user) : null,
]);
