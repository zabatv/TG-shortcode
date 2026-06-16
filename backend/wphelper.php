<?php
$paths = array(
    dirname(__FILE__) . '/../wp-config.php',
    dirname(__FILE__) . '/../../wp-config.php',
    '/home/m/mdmbkr46/amir-kbr.ru/wp-config.php',
    '/var/www/amir-kbr.ru/wp-config.php',
    '/ssd/www/amir-kbr.ru/wp-config.php'
);

$wpConfig = null;
foreach ($paths as $path) {
    if (file_exists($path)) { $wpConfig = $path; break; }
}

$result = array();

if (!$wpConfig) {
    $result['error'] = 'wp-config not found';
    $result['searched'] = $paths;
    $result['dir'] = dirname(__FILE__);
    $result['pwd'] = getcwd();
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

$result['wp_config'] = $wpConfig;
$config = file_get_contents($wpConfig);

preg_match("/define\s*\(\s*'DB_NAME'\s*,\s*'([^']+)'/", $config, $m);
$dbName = isset($m[1]) ? $m[1] : '';
preg_match("/define\s*\(\s*'DB_USER'\s*,\s*'([^']+)'/", $config, $m);
$dbUser = isset($m[1]) ? $m[1] : '';
preg_match("/define\s*\(\s*'DB_PASSWORD'\s*,\s*'([^']+)'/", $config, $m);
$dbPass = isset($m[1]) ? $m[1] : '';
preg_match("/define\s*\(\s*'DB_HOST'\s*,\s*'([^']+)'/", $config, $m);
$dbHost = isset($m[1]) ? $m[1] : 'localhost';

$result['db'] = array('name' => $dbName, 'user' => $dbUser, 'host' => $dbHost);

$wpLoad = dirname($wpConfig) . '/wp-load.php';
if (file_exists($wpLoad)) {
    $result['wp_load'] = $wpLoad;
    $_SERVER['DOCUMENT_ROOT'] = dirname($wpConfig);
    chdir(dirname($wpConfig));
    define('WP_USE_THEMES', false);
    require_once $wpLoad;
    $themeMods = get_option('astra-settings');
    if ($themeMods) {
        $result['theme_mods_found'] = true;
        $result['theme_mods_keys'] = array_keys($themeMods);
    } else {
        $result['theme_mods_found'] = false;
    }
} else {
    $result['error'] = 'wp-load.php not found at ' . $wpLoad;
}

echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
