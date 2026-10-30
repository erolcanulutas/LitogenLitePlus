<?php
/**
 * Optional. Without it the site uses SQLite in ../litogen-data, which needs
 * nothing set up and is enough to sign people in.
 *
 * The real copy lives one level above public_html, where the web server cannot
 * reach it however the rewrite rules are configured — a config file inside the
 * document root is one misplaced rule away from being served as plain text
 * with the database password in it.
 *
 * To move to MySQL: create the database and user in cPanel, copy this to
 * /home/<account>/litogen-config.php and fill it in.
 */

return [
    // Leave the driver out entirely to stay on SQLite, which needs nothing set
    // up. These four are only read when 'driver' is 'mysql'.
    // 'driver'  => 'mysql',
    // 'db_host' => 'localhost',
    // 'db_name' => '',
    // 'db_user' => '',
    // 'db_pass' => '',
];
