<?php
/**
 * Plugin Name: Управление танцами
 * Description: Админ-панель для филиалов, групп и записей. Шорткод формы: [rubitime_form]
 * Version: 1.0
 */

define('RT_API', 'https://dance-notifier.onrender.com/api');

add_action('admin_menu', 'rt_admin_menu');
function rt_admin_menu() {
    $cap = 'edit_posts';
    add_menu_page('Танцы', 'Танцы', $cap, 'rt-dance', 'rt_branches_page', 'dashicons-groups', 25);
    add_submenu_page('rt-dance', 'Филиалы', 'Филиалы', $cap, 'rt-dance', 'rt_branches_page');
    add_submenu_page('rt-dance', 'Группы', 'Группы', $cap, 'rt-groups', 'rt_groups_page');
    add_submenu_page('rt-dance', 'Записи', 'Записи', $cap, 'rt-regs', 'rt_regs_page');
}

add_action('admin_enqueue_scripts', 'rt_admin_assets');
function rt_admin_assets($hook) {
    if (strpos($hook, 'rt-') === false) return;
    wp_enqueue_style('rt-admin', false);
    echo '<style>
.rt-wrap{max-width:900px;margin:20px 0}
.rt-wrap h1{margin-bottom:20px}
.rt-card{background:#fff;border:1px solid #c3c4c7;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.rt-card h2{margin-top:0}
.rt-table{width:100%;border-collapse:collapse}
.rt-table th,.rt-table td{text-align:left;padding:10px 12px;border-bottom:1px solid #f0f0f1}
.rt-table th{background:#f6f7f7;font-weight:600}
.rt-actions{display:flex;gap:8px;flex-wrap:wrap}
.rt-msg{padding:12px 16px;margin:12px 0;border-radius:4px}
.rt-msg.ok{background:#edfaef;border:1px solid #68de7c;color:#2a7c2f}
.rt-msg.err{background:#fcf0f1;border:1px solid #f5a2a2;color:#b32d2e}
.rt-form label{display:block;margin-bottom:6px;font-weight:600}
.rt-form input,.rt-form textarea{width:100%;max-width:400px;margin-bottom:16px}
.rt-form .rt-row{display:flex;gap:12px;flex-wrap:wrap}
.rt-form .rt-row > div{flex:1;min-width:180px}
</style>';
}

function rt_api_get($path) {
    $resp = wp_remote_get(RT_API . $path, array('timeout' => 10));
    if (is_wp_error($resp)) return array();
    $data = json_decode(wp_remote_retrieve_body($resp), true);
    return is_array($data) ? $data : array();
}

function rt_api_post($path, $body) {
    $resp = wp_remote_post(RT_API . $path, array(
        'headers' => array('Content-Type' => 'application/json'),
        'body' => json_encode($body),
        'timeout' => 10,
    ));
    return $resp;
}

function rt_api_put($path, $body) {
    $resp = wp_remote_request(RT_API . $path, array(
        'method' => 'PUT',
        'headers' => array('Content-Type' => 'application/json'),
        'body' => json_encode($body),
        'timeout' => 10,
    ));
    return $resp;
}

function rt_api_delete($path) {
    wp_remote_request(RT_API . $path, array(
        'method' => 'DELETE',
        'timeout' => 10,
    ));
}

// ===== Филиалы =====
function rt_branches_page() {
    $msg = '';

    if (!empty($_POST['rt_action'])) {
        if ($_POST['rt_action'] === 'add_branch') {
            $key = sanitize_title($_POST['key']);
            $name = sanitize_text_field($_POST['name']);
            $teacher = sanitize_text_field($_POST['teacher']);
            $days = sanitize_text_field($_POST['days']);
            $resp = wp_remote_post(RT_API . '/branches', array(
                'headers' => array('Content-Type' => 'application/json'),
                'body' => json_encode(compact('key', 'name', 'teacher', 'days')),
                'timeout' => 10,
            ));
            $msg = is_wp_error($resp) ? $resp->get_error_message() : 'Филиал добавлен';
        }
        if ($_POST['rt_action'] === 'edit_branch') {
            rt_api_put('/branches/' . intval($_POST['id']), array(
                'name' => sanitize_text_field($_POST['name']),
                'teacher' => sanitize_text_field($_POST['teacher']),
                'days' => sanitize_text_field($_POST['days']),
            ));
            $msg = 'Филиал обновлён';
        }
    }

    if (!empty($_GET['del'])) {
        rt_api_delete('/branches/' . intval($_GET['del']));
        $msg = 'Филиал удалён';
    }

    $branches = rt_api_get('/branches');

    echo '<div class="rt-wrap">';
    echo '<h1>Филиалы</h1>';
    if ($msg) echo '<div class="rt-msg ok">' . esc_html($msg) . '</div>';

    echo '<div class="rt-card">';
    echo '<h2>+ Добавить филиал</h2>';
    echo '<form method="post" class="rt-form">';
    echo '<input type="hidden" name="rt_action" value="add_branch">';
    echo '<div class="rt-row">';
    echo '<div><label>Ключ (англ)</label><input type="text" name="key" required></div>';
    echo '<div><label>Название</label><input type="text" name="name" required></div>';
    echo '</div>';
    echo '<div class="rt-row">';
    echo '<div><label>Преподаватель</label><input type="text" name="teacher"></div>';
    echo '<div><label>Дни занятий</label><input type="text" name="days" placeholder="Вторник, четверг"></div>';
    echo '</div>';
    echo '<button class="button button-primary">Добавить</button>';
    echo '</form>';
    echo '</div>';

    echo '<div class="rt-card">';
    echo '<h2>Список филиалов</h2>';
    if (empty($branches)) {
        echo '<p>Нет филиалов.</p>';
    } else {
        echo '<table class="rt-table"><thead><tr><th>Название</th><th>Ключ</th><th>Преподаватель</th><th>Дни</th><th></th></tr></thead><tbody>';
        foreach ($branches as $b) {
            $branchData = array('id' => $b['id'], 'name' => $b['name'], 'teacher' => $b['teacher'] ?? '', 'days' => $b['days'] ?? '');
            echo '<tr data-branch=\'' . esc_attr(json_encode($branchData, JSON_HEX_TAG | JSON_HEX_APOS)) . '\'>';
            echo '<td><strong>' . esc_html($b['name']) . '</strong></td>';
            echo '<td><code>' . esc_html($b['key']) . '</code></td>';
            echo '<td>' . esc_html($b['teacher'] ?: '') . '</td>';
            echo '<td>' . esc_html($b['days'] ?: '') . '</td>';
            echo '<td class="rt-actions">';
            echo '<button class="button button-small edit-branch-btn">edit</button>';
            echo '<a href="?page=rt-dance&del=' . $b['id'] . '" class="button button-small" onclick="return confirm(\'Удалить?\')">del</a>';
            echo '</td></tr>';
        }
        echo '</tbody></table>';
    }
    echo '</div>';

    // Edit form
    echo '<div class="rt-card" id="rt-edit" style="display:none">';
    echo '<h2>Редактировать</h2>';
    echo '<form method="post" class="rt-form">';
    echo '<input type="hidden" name="rt_action" value="edit_branch">';
    echo '<input type="hidden" name="id" id="eid">';
    echo '<div class="rt-row">';
    echo '<div><label>Название</label><input type="text" name="name" id="ename" required></div>';
    echo '<div><label>Преподаватель</label><input type="text" name="teacher" id="eteacher"></div>';
    echo '</div>';
    echo '<div><label>Дни</label><input type="text" name="days" id="edays"></div>';
    echo '<button class="button button-primary">Сохранить</button>';
    echo '<button class="button" type="button" onclick="document.getElementById(\'rt-edit\').style.display=\'none\'">Отмена</button>';
    echo '</form>';
    echo '</div>';

    echo '<script>
    document.addEventListener("click", function(e) {
        var btn = e.target.closest(".edit-branch-btn");
        if (btn) {
            var tr = btn.closest("tr");
            var d = JSON.parse(tr.getAttribute("data-branch"));
            document.getElementById("eid").value = d.id;
            document.getElementById("ename").value = d.name;
            document.getElementById("eteacher").value = d.teacher || "";
            document.getElementById("edays").value = d.days || "";
            document.getElementById("rt-edit").style.display = "block";
        }
    });
    </script>';
    echo '</div>';
}

// ===== Группы =====
function rt_groups_page() {
    $msg = '';

    if (!empty($_POST['rt_action'])) {
        if ($_POST['rt_action'] === 'add_group') {
            wp_remote_post(RT_API . '/groups', array(
                'headers' => array('Content-Type' => 'application/json'),
                'body' => json_encode(array(
                    'branch_id' => intval($_POST['branch_id']),
                    'key' => sanitize_title($_POST['name']),
                    'name' => sanitize_text_field($_POST['name']),
                    'time' => sanitize_text_field($_POST['time']),
                    'links' => sanitize_textarea_field($_POST['links']),
                )),
                'timeout' => 10,
            ));
            $msg = 'Группа добавлена';
        }
        if ($_POST['rt_action'] === 'edit_group') {
            rt_api_put('/groups/' . intval($_POST['id']), array(
                'name' => sanitize_text_field($_POST['name']),
                'time' => sanitize_text_field($_POST['time']),
                'links' => sanitize_textarea_field($_POST['links']),
            ));
            $msg = 'Группа обновлена';
        }
    }

    if (!empty($_GET['del'])) {
        rt_api_delete('/groups/' . intval($_GET['del']));
        $msg = 'Группа удалена';
    }

    $branches = rt_api_get('/branches');

    echo '<div class="rt-wrap">';
    echo '<h1>Группы</h1>';
    if ($msg) echo '<div class="rt-msg ok">' . esc_html($msg) . '</div>';

    echo '<div class="rt-card">';
    echo '<h2>+ Добавить группу</h2>';
    echo '<form method="post" class="rt-form">';
    echo '<input type="hidden" name="rt_action" value="add_group">';
    echo '<div class="rt-row">';
    echo '<div><label>Филиал</label><select name="branch_id" required style="max-width:400px;width:100%">';
    echo '<option value="">—</option>';
    foreach ($branches as $b) {
        echo '<option value="' . $b['id'] . '">' . esc_html($b['name']) . '</option>';
    }
    echo '</select></div>';
    echo '<div><label>Название</label><input type="text" name="name" required></div>';
    echo '<div><label>Время</label><input type="text" name="time" placeholder="18:00-19:20"></div>';
    echo '</div>';
    echo '<div><label>Ссылки (JSON)</label>';
    echo '<textarea name="links" rows="3" placeholder=\'[{"label":"Telegram","url":"https://t.me/..."}]\' style="max-width:400px;width:100%"></textarea></div>';
    echo '<button class="button button-primary">Добавить</button>';
    echo '</form>';
    echo '</div>';

    echo '<div class="rt-card">';
    echo '<h2>Список групп</h2>';
    if (empty($branches)) {
        echo '<p>Сначала добавьте филиал.</p>';
    } else {
        foreach ($branches as $b) {
            echo '<h3>' . esc_html($b['name']) . '</h3>';
            echo '<table class="rt-table"><thead><tr><th>Название</th><th>Время</th><th></th></tr></thead><tbody>';
            if (!empty($b['groups'])) {
                foreach ($b['groups'] as $g) {
                    echo '<tr data-group=\'' . esc_attr(json_encode($g, JSON_HEX_TAG | JSON_HEX_APOS)) . '\'>';
                    echo '<td>' . esc_html($g['name']) . '</td>';
                    echo '<td>' . esc_html($g['time'] ?: '') . '</td>';
                    echo '<td class="rt-actions">';
                    echo '<button class="button button-small edit-group-btn">edit</button>';
                    echo '<a href="?page=rt-groups&del=' . $g['id'] . '" class="button button-small" onclick="return confirm(\'Удалить?\')">del</a>';
                    echo '</td></tr>';
                }
            } else {
                echo '<tr><td colspan="3" style="color:#999">Нет групп</td></tr>';
            }
            echo '</tbody></table>';
        }
    }
    echo '</div>';

    echo '<div class="rt-card" id="rt-edit-group" style="display:none">';
    echo '<h2>Редактировать группу</h2>';
    echo '<form method="post" class="rt-form">';
    echo '<input type="hidden" name="rt_action" value="edit_group">';
    echo '<input type="hidden" name="id" id="egid">';
    echo '<div class="rt-row">';
    echo '<div><label>Название</label><input type="text" name="name" id="egname" required></div>';
    echo '<div><label>Время</label><input type="text" name="time" id="egtime"></div>';
    echo '</div>';
    echo '<div><label>Ссылки (JSON)</label>';
    echo '<textarea name="links" id="eglinks" rows="3" placeholder=\'[{"label":"Telegram","url":"https://t.me/..."},{"label":"WhatsApp","url":"https://..."}]\' style="max-width:400px;width:100%"></textarea>';
    echo '<p style="font-size:12px;color:#666">Формат: массив объектов с полями label и url</p>';
    echo '</div>';
    echo '<button class="button button-primary">Сохранить</button>';
    echo '<button class="button" type="button" onclick="document.getElementById(\'rt-edit-group\').style.display=\'none\'">Отмена</button>';
    echo '</form>';
    echo '</div>';

    echo '<script>
    document.addEventListener("click", function(e) {
        var btn, tr, d;
        btn = e.target.closest(".edit-branch-btn");
        if (btn) {
            tr = btn.closest("tr");
            d = JSON.parse(tr.getAttribute("data-branch"));
            document.getElementById("eid").value = d.id;
            document.getElementById("ename").value = d.name;
            document.getElementById("eteacher").value = d.teacher || "";
            document.getElementById("edays").value = d.days || "";
            document.getElementById("rt-edit").style.display = "block";
            return;
        }
        btn = e.target.closest(".edit-group-btn");
        if (btn) {
            tr = btn.closest("tr");
            d = JSON.parse(tr.getAttribute("data-group"));
            document.getElementById("egid").value = d.id;
            document.getElementById("egname").value = d.name;
            document.getElementById("egtime").value = d.time || "";
            document.getElementById("eglinks").value = d.links || "";
            document.getElementById("rt-edit-group").style.display = "block";
        }
    });
    </script>';
    echo '</div>';
}

// ===== Записи =====
function rt_regs_page() {
    $msg = '';

    // Добавить запись
    if (!empty($_POST['rt_action']) && $_POST['rt_action'] === 'add_reg') {
        wp_remote_post(RT_API . '/notify', array(
            'headers' => array('Content-Type' => 'application/json'),
            'body' => json_encode(array(
                'branch' => sanitize_text_field($_POST['branch']),
                'group' => sanitize_text_field($_POST['group']),
                'name' => sanitize_text_field($_POST['name']),
                'phone' => sanitize_text_field($_POST['phone']),
                'comment' => sanitize_text_field($_POST['comment']),
            )),
            'timeout' => 10,
        ));
        $msg = 'Запись добавлена';
    }

    // Удалить запись
    if (!empty($_GET['del'])) {
        rt_api_delete('/registrations/' . intval($_GET['del']));
        $msg = 'Запись удалена';
    }

    $branch = isset($_GET['branch']) ? $_GET['branch'] : '';
    $group = isset($_GET['group']) ? $_GET['group'] : '';
    $url = '/registrations?limit=200';
    if ($branch) $url .= '&branch=' . urlencode($branch);
    if ($group) $url .= '&group=' . urlencode($group);

    $rows = rt_api_get($url);
    $branches = rt_api_get('/branches');

    echo '<div class="rt-wrap">';
    echo '<h1>Записи</h1>';
    if ($msg) echo '<div class="rt-msg ok">' . esc_html($msg) . '</div>';

    // Форма добавления
    echo '<div class="rt-card">';
    echo '<h2>+ Добавить запись вручную</h2>';
    echo '<form method="post" class="rt-form">';
    echo '<input type="hidden" name="rt_action" value="add_reg">';
    echo '<div class="rt-row">';
    echo '<div><label>Филиал</label>';
    echo '<select name="branch" required style="max-width:400px;width:100%"><option value="">—</option>';
    foreach ($branches as $b) {
        echo '<option value="' . esc_attr($b['name']) . '">' . esc_html($b['name']) . '</option>';
    }
    echo '</select></div>';
    echo '<div><label>Группа</label><input type="text" name="group" required placeholder="Старшая (девочки)"></div>';
    echo '</div>';
    echo '<div class="rt-row">';
    echo '<div><label>Имя</label><input type="text" name="name" required></div>';
    echo '<div><label>Телефон</label><input type="text" name="phone" required></div>';
    echo '</div>';
    echo '<div><label>Комментарий</label><input type="text" name="comment"></div>';
    echo '<button class="button button-primary">Добавить</button>';
    echo '</form>';
    echo '</div>';

    // Список
    echo '<div class="rt-card">';
    echo '<p>Всего: <strong>' . count($rows) . '</strong></p>';
    if (empty($rows)) {
        echo '<p>Пока нет записей.</p>';
    } else {
        echo '<table class="rt-table"><thead><tr><th>#</th><th>Филиал</th><th>Группа</th><th>Имя</th><th>Телефон</th><th>Дата</th><th>Перешёл</th><th></th></tr></thead><tbody>';
        foreach ($rows as $i => $r) {
            $clicked = !empty($r['clicked'])
                ? '<span style="color:#090">✔ ' . date('d.m H:i', strtotime($r['clicked_at'])) . '</span>'
                : '<span style="color:#999">—</span>';
            echo '<tr>';
            echo '<td>' . ($i + 1) . '</td>';
            echo '<td>' . esc_html($r['branch']) . '</td>';
            echo '<td>' . esc_html($r['group_name']) . '</td>';
            echo '<td>' . esc_html($r['name'] ?: '') . '</td>';
            echo '<td>' . esc_html($r['phone'] ?: '') . '</td>';
            echo '<td>' . date('d.m.Y H:i', strtotime($r['created_at'])) . '</td>';
            echo '<td>' . $clicked . '</td>';
            echo '<td><a href="?page=rt-regs&del=' . $r['id'] . '" class="button button-small" onclick="return confirm(\'Удалить?\')">del</a></td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
    }
    echo '</div></div>';
}
