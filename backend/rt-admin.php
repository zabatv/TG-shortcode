<?php
/**
 * Plugin Name: Управление танцами
 * Description: Админ-панель для управления филиалами и группами. Шорткод формы: [rubitime_form]
 * Version: 1.0
 */

define('RT_API', 'https://dance-notifier.onrender.com/api');

// Меню в админке
add_action('admin_menu', 'rt_admin_menu');
function rt_admin_menu() {
    add_menu_page('Танцы', 'Танцы', 'manage_options', 'rt-dance', 'rt_branches_page', 'dashicons-groups', 25);
    add_submenu_page('rt-dance', 'Филиалы', 'Филиалы', 'manage_options', 'rt-dance', 'rt_branches_page');
    add_submenu_page('rt-dance', 'Группы', 'Группы', 'manage_options', 'rt-groups', 'rt_groups_page');
    add_submenu_page('rt-dance', 'Записи', 'Записи', 'manage_options', 'rt-regs', 'rt_regs_page');
}

// Подключить JS/CSS
add_action('admin_enqueue_scripts', 'rt_admin_assets');
function rt_admin_assets($hook) {
    if (strpos($hook, 'rt-') === false) return;
    wp_enqueue_style('rt-admin', false);
    ?>
<style>
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
.rt-badge{display:inline-block;background:#f0f0f1;padding:2px 10px;border-radius:12px;font-size:12px;margin:2px}
</style>
<?php
}

// ===== Страница филиалов =====
function rt_branches_page() {
    echo '<div class="rt-wrap"><h1>Филиалы</h1>';

    // Обработка форм
    if ($_POST['rt_action'] === 'add_branch') {
        $resp = wp_remote_post(RT_API . '/branches', [
            'headers' => ['Content-Type' => 'application/json'],
            'body' => json_encode([
                'key' => sanitize_title($_POST['key']),
                'name' => sanitize_text_field($_POST['name']),
                'teacher' => sanitize_text_field($_POST['teacher']),
                'days' => sanitize_text_field($_POST['days']),
            ]),
            'timeout' => 10,
        ]);
        if (is_wp_error($resp)) echo '<div class="rt-msg err">Ошибка: ' . $resp->get_error_message() . '</div>';
        else echo '<div class="rt-msg ok">Филиал добавлен</div>';
    }

    if ($_POST['rt_action'] === 'edit_branch') {
        wp_remote_post(RT_API . '/branches/' . intval($_POST['id']), [
            'headers' => ['Content-Type' => 'application/json'],
            'body' => json_encode([
                'name' => sanitize_text_field($_POST['name']),
                'teacher' => sanitize_text_field($_POST['teacher']),
                'days' => sanitize_text_field($_POST['days']),
            ]),
            'timeout' => 10,
            'method' => 'PUT',
        ]);
        echo '<div class="rt-msg ok">Филиал обновлён</div>';
    }

    if ($_GET['del'] ?? '') {
        wp_remote_post(RT_API . '/branches/' . intval($_GET['del']), [
            'method' => 'DELETE',
            'timeout' => 10,
        ]);
        echo '<div class="rt-msg ok">Филиал удалён</div>';
    }

    // Форма добавления
    ?>
    <div class="rt-card">
        <h2>➕ Добавить филиал</h2>
        <form method="post" class="rt-form">
            <input type="hidden" name="rt_action" value="add_branch">
            <div class="rt-row">
                <div>
                    <label>Ключ (англ, без пробелов)</label>
                    <input type="text" name="key" required>
                </div>
                <div>
                    <label>Название</label>
                    <input type="text" name="name" required>
                </div>
            </div>
            <div class="rt-row">
                <div>
                    <label>Преподаватель</label>
                    <input type="text" name="teacher">
                </div>
                <div>
                    <label>Дни занятий</label>
                    <input type="text" name="days" placeholder="Напр: Вторник, четверг">
                </div>
            </div>
            <button class="button button-primary">Добавить</button>
        </form>
    </div>
    <?php

    // Список филиалов
    $resp = wp_remote_get(RT_API . '/branches', ['timeout' => 10]);
    $branches = !is_wp_error($resp) ? json_decode(wp_remote_retrieve_body($resp), true) : [];
    if (!is_array($branches)) $branches = [];

    echo '<div class="rt-card"><h2>Список филиалов</h2>';
    if (empty($branches)) { echo '<p>Нет филиалов. Добавьте первый.</p>'; }
    else {
        echo '<table class="rt-table"><thead><tr>
            <th>Название</th><th>Ключ</th><th>Преподаватель</th><th>Дни</th><th>Действия</th>
        </tr></thead><tbody>';
        foreach ($branches as $b) {
            echo '<tr>';
            echo '<td><strong>' . esc_html($b['name']) . '</strong></td>';
            echo '<td><code>' . esc_html($b['key']) . '</code></td>';
            echo '<td>' . esc_html($b['teacher'] ?: '—') . '</td>';
            echo '<td>' . esc_html($b['days'] ?: '—') . '</td>';
            echo '<td class="rt-actions">';
            echo '<button class="button button-small" onclick="rtEditBranch(' . $b['id'] . ', ' . esc_attr(json_encode($b)) . ')">✏️</button> ';
            echo '<a href="?page=rt-dance&del=' . $b['id'] . '" class="button button-small" onclick="return confirm(\'Удалить?\')">❌</a>';
            echo '</td></tr>';
        }
        echo '</tbody></table>';
    }
    echo '</div>';

    // Форма редактирования (скрыта, показывается через JS)
    echo '<div class="rt-card" id="rt-edit-card" style="display:none">
        <h2>✏️ Редактировать филиал</h2>
        <form method="post" class="rt-form">
            <input type="hidden" name="rt_action" value="edit_branch">
            <input type="hidden" name="id" id="edit-id">
            <div class="rt-row">
                <div>
                    <label>Название</label>
                    <input type="text" name="name" id="edit-name" required>
                </div>
                <div>
                    <label>Преподаватель</label>
                    <input type="text" name="teacher" id="edit-teacher">
                </div>
            </div>
            <div>
                <label>Дни занятий</label>
                <input type="text" name="days" id="edit-days">
            </div>
            <button class="button button-primary">Сохранить</button>
            <button class="button" type="button" onclick="document.getElementById(\'rt-edit-card\').style.display=\'none\'">Отмена</button>
        </form>
    </div>';
    ?>
    <script>
    function rtEditBranch(id, b) {
        document.getElementById('edit-id').value = id;
        document.getElementById('edit-name').value = b.name;
        document.getElementById('edit-teacher').value = b.teacher || '';
        document.getElementById('edit-days').value = b.days || '';
        document.getElementById('rt-edit-card').style.display = 'block';
        document.getElementById('rt-edit-card').scrollIntoView();
    }
    </script>
    <?php
    echo '</div>';
}

// ===== Страница групп =====
function rt_groups_page() {
    echo '<div class="rt-wrap"><h1>Группы</h1>';

    // Получить филиалы для выпадающего списка
    $resp = wp_remote_get(RT_API . '/branches', ['timeout' => 10]);
    $branches = !is_wp_error($resp) ? json_decode(wp_remote_retrieve_body($resp), true) : [];
    if (!is_array($branches)) $branches = [];

    // Обработка форм
    if ($_POST['rt_action'] === 'add_group') {
        $branchId = intval($_POST['branch_id']);
        $name = sanitize_text_field($_POST['name']);
        $key = sanitize_title($name);
        $time = sanitize_text_field($_POST['time']);
        wp_remote_post(RT_API . '/groups', [
            'headers' => ['Content-Type' => 'application/json'],
            'body' => json_encode(compact('branch_id', 'key', 'name', 'time')),
            'timeout' => 10,
        ]);
        echo '<div class="rt-msg ok">Группа добавлена</div>';
    }

    if ($_POST['rt_action'] === 'edit_group') {
        wp_remote_post(RT_API . '/groups/' . intval($_POST['id']), [
            'headers' => ['Content-Type' => 'application/json'],
            'body' => json_encode([
                'name' => sanitize_text_field($_POST['name']),
                'time' => sanitize_text_field($_POST['time']),
            ]),
            'timeout' => 10,
            'method' => 'PUT',
        ]);
        echo '<div class="rt-msg ok">Группа обновлена</div>';
    }

    if ($_GET['del_group'] ?? '') {
        wp_remote_post(RT_API . '/groups/' . intval($_GET['del_group']), [
            'method' => 'DELETE',
            'timeout' => 10,
        ]);
        echo '<div class="rt-msg ok">Группа удалена</div>';
    }

    // Форма добавления
    ?>
    <div class="rt-card">
        <h2>➕ Добавить группу</h2>
        <form method="post" class="rt-form">
            <input type="hidden" name="rt_action" value="add_group">
            <div class="rt-row">
                <div>
                    <label>Филиал</label>
                    <select name="branch_id" required style="max-width:400px;width:100%">
                        <option value="">— выберите —</option>
                        <?php foreach ($branches as $b): ?>
                        <option value="<?= $b['id'] ?>"><?= esc_html($b['name']) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label>Название группы</label>
                    <input type="text" name="name" required>
                </div>
                <div>
                    <label>Время</label>
                    <input type="text" name="time" placeholder="18:00–19:20">
                </div>
            </div>
            <button class="button button-primary">Добавить</button>
        </form>
    </div>
    <?php

    // Список групп по филиалам
    echo '<div class="rt-card"><h2>Список групп</h2>';
    if (empty($branches)) {
        echo '<p>Сначала добавьте филиал.</p>';
    } else {
        foreach ($branches as $b) {
            $resp2 = wp_remote_get(RT_API . '/branches', ['timeout' => 5]);
            // Получаем группы через отдельный запрос
            $gresp = wp_remote_get(RT_API . '/branches', ['timeout' => 5]);
            // Для групп используем другой подход — получаем все записи
            echo '<h3>' . esc_html($b['name']) . '</h3>';

            // Получаем список групп через branches API (там есть groups)
            echo '<table class="rt-table"><thead><tr>
                <th>Название</th><th>Время</th><th>Действия</th>
            </tr></thead><tbody>';
            if (!empty($b['groups'])) {
                foreach ($b['groups'] as $g) {
                    echo '<tr>';
                    echo '<td>' . esc_html($g['name']) . '</td>';
                    echo '<td>' . esc_html($g['time'] ?: '—') . '</td>';
                    echo '<td class="rt-actions">';
                    echo '<button class="button button-small" onclick="rtEditGroup(' . esc_attr(json_encode($g)) . ')">✏️</button> ';
                    echo '<a href="?page=rt-groups&del_group=' . $g['id'] . '" class="button button-small" onclick="return confirm(\'Удалить?\')">❌</a>';
                    echo '</td></tr>';
                }
            } else {
                echo '<tr><td colspan="3" style="color:#999">Нет групп</td></tr>';
            }
            echo '</tbody></table>';
        }
    }
    echo '</div>';

    // Форма редактирования
    echo '<div class="rt-card" id="rt-edit-card" style="display:none">
        <h2>✏️ Редактировать группу</h2>
        <form method="post" class="rt-form">
            <input type="hidden" name="rt_action" value="edit_group">
            <input type="hidden" name="id" id="edit-gid">
            <div class="rt-row">
                <div>
                    <label>Название</label>
                    <input type="text" name="name" id="edit-gname" required>
                </div>
                <div>
                    <label>Время</label>
                    <input type="text" name="time" id="edit-gtime">
                </div>
            </div>
            <button class="button button-primary">Сохранить</button>
            <button class="button" type="button" onclick="this.closest(\'.rt-card\').style.display=\'none\'">Отмена</button>
        </form>
    </div>';
    ?>
    <script>
    function rtEditGroup(g) {
        document.getElementById('edit-gid').value = g.id;
        document.getElementById('edit-gname').value = g.name;
        document.getElementById('edit-gtime').value = g.time || '';
        document.getElementById('rt-edit-card').style.display = 'block';
        document.getElementById('rt-edit-card').scrollIntoView();
    }
    </script>
    <?php
    echo '</div>';
}

// ===== Страница записей =====
function rt_regs_page() {
    echo '<div class="rt-wrap"><h1>Записи</h1>';

    $branch = $_GET['branch'] ?? '';
    $group = $_GET['group'] ?? '';
    $url = RT_API . '/registrations?limit=100';
    if ($branch) $url .= '&branch=' . urlencode($branch);
    if ($group) $url .= '&group=' . urlencode($group);

    $resp = wp_remote_get($url, ['timeout' => 10]);
    $rows = !is_wp_error($resp) ? json_decode(wp_remote_retrieve_body($resp), true) : [];
    if (!is_array($rows)) $rows = [];

    echo '<div class="rt-card"><p><strong>Всего записей:</strong> ' . count($rows) . '</p>';
    if (empty($rows)) {
        echo '<p>Пока нет записей.</p>';
    } else {
        echo '<table class="rt-table"><thead><tr>
            <th>#</th><th>Филиал</th><th>Группа</th><th>Имя</th><th>Телефон</th><th>Комментарий</th><th>Дата</th>
        </tr></thead><tbody>';
        foreach ($rows as $i => $r) {
            echo '<tr>';
            echo '<td>' . ($i + 1) . '</td>';
            echo '<td>' . esc_html($r['branch']) . '</td>';
            echo '<td>' . esc_html($r['group_name']) . '</td>';
            echo '<td>' . esc_html($r['name'] ?: '—') . '</td>';
            echo '<td>' . esc_html($r['phone'] ?: '—') . '</td>';
            echo '<td>' . esc_html($r['comment'] ?: '—') . '</td>';
            echo '<td>' . date('d.m.Y H:i', strtotime($r['created_at'])) . '</td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
    }
    echo '</div></div>';
}
