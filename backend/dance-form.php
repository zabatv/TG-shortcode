<?php
/**
 * Plugin Name: Форма записи на танцы
 * Description: Форма записи с уведомлениями в Telegram. Филиалы и группы берутся из БД. Шорткод: [rubitime_form]
 * Version: 2.1
 */

define('RENDER_WEBHOOK_URL', 'https://dance-notifier.onrender.com/notify');
define('RENDER_API_URL', 'https://dance-notifier.onrender.com/api');

function rubitime_get_branches() {
    $cache = get_transient('rt_branches_cache');
    if ($cache) return $cache;

    $resp = wp_remote_get(RENDER_API_URL . '/branches', ['timeout' => 10]);
    if (is_wp_error($resp)) return [];

    $data = json_decode(wp_remote_retrieve_body($resp), true);
    if (!is_array($data)) return [];

    set_transient('rt_branches_cache', $data, HOUR_IN_SECONDS);
    return $data;
}

function rubitime_form_shortcode($atts) {
    ob_start(); ?>
<div class="rt-container" id="rt-app">

  <div class="rt-screen" id="rt-s1">
    <h1>Выберите филиал</h1>
    <div class="rt-btns" id="rt-branches-list"></div>
  </div>

  <div class="rt-screen rt-hide" id="rt-s2">
    <button class="rt-back" data-back="rt-s1">← Назад</button>
    <h1 id="rt-s2-title">Выберите группу</h1>
    <div class="rt-branch-info-box" id="rt-branch-info-box">
      <div class="rt-info-row" id="rt-info-days"></div>
      <div class="rt-info-row" id="rt-info-teacher"></div>
    </div>
    <div class="rt-btns" id="rt-groups-list"></div>
  </div>

  <div class="rt-screen rt-hide" id="rt-s3">
    <button class="rt-back" data-back="rt-s2">← Назад</button>
    <h1 id="rt-s3-title">Правила группы</h1>
    <p class="rt-label" id="rt-group-info"></p>
    <div class="rt-rules-box" id="rt-rules-box"></div>

    <label class="rt-field">
      <span>Имя ребёнка</span>
      <input type="text" id="rt-name" placeholder="Например: Анна" />
    </label>
    <label class="rt-field">
      <span>Телефон родителя</span>
      <input type="tel" id="rt-phone" placeholder="+7 (999) 123-45-67" />
    </label>

    <label class="rt-check">
      <input type="checkbox" id="rt-agree">
      <span>Я прочитал(а) правила</span>
    </label>
    <div class="rt-error rt-hide" id="rt-error-msg"></div>
    <button type="button" class="rt-submit" id="rt-enroll-btn" disabled>Записаться</button>
  </div>

  <div class="rt-screen rt-hide" id="rt-s4">
    <h1>Заявка отправлена!</h1>
    <p class="rt-label" id="rt-s4-info"></p>
    <div class="rt-success-block">
      <p>Пожалуйста, зайдите в вашу группу — там мы будем сообщать об изменениях</p>
    </div>
    <div class="rt-btns" id="rt-group-links"></div>
    <button class="rt-btn" id="rt-restart" style="margin-top:16px;background:transparent;color:#010b12;border:2px solid #010b12;">Записаться ещё</button>
  </div>

  <div class="rt-load rt-hide" id="rt-load"><div class="rt-spin"></div><p>Отправка...</p></div>
</div>

<style>
.rt-container{background:#edfbe2;padding:32px 24px;max-width:400px;margin:20px auto;position:relative;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.rt-screen{transition:opacity .3s ease}
.rt-hide{display:none}
.rt-container h1{font-size:24px;font-weight:700;color:#010b12;margin:0 0 24px 0;text-align:center}
.rt-btns{display:flex;flex-direction:column;gap:12px}
.rt-btn,.rt-submit{width:100%;padding:16px 18px;font-size:18px;font-weight:700;color:#fff;background:#010b12;border:none;border-radius:0;cursor:pointer;transition:opacity .2s;text-align:center;text-decoration:none;display:block;box-sizing:border-box}
.rt-btn:hover,.rt-submit:hover{opacity:.85}
.rt-back{background:0;border:none;color:#010b12;font-size:16px;font-weight:600;cursor:pointer;padding:0;margin-bottom:16px}
.rt-back:hover{text-decoration:underline}
.rt-label{text-align:center;font-size:14px;color:#333;margin-bottom:20px;line-height:1.5}
.rt-branch-info-box{background:#fff;border:2px solid #c0d0b0;padding:16px;margin-bottom:24px;border-radius:0}
.rt-info-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;font-size:14px;color:#333;line-height:1.5}
.rt-info-row:last-child{margin-bottom:0}
.rt-info-row::before{content:"";display:block;width:6px;height:6px;background:#010b12;border-radius:50%;margin-top:7px;flex-shrink:0}
.rt-info-row strong{color:#010b12;font-weight:600;margin-right:4px}
.rt-rules-box{background:#fff;border:2px solid #c0d0b0;padding:20px;margin-bottom:20px;font-size:14px;line-height:1.7;color:#333;max-height:300px;overflow-y:auto}
.rt-rules-box ul{margin:8px 0;padding-left:20px}
.rt-rules-box li{margin-bottom:6px}
.rt-check{display:flex;align-items:center;gap:10px;font-size:15px;color:#010b12;cursor:pointer;margin-bottom:16px;user-select:none}
.rt-check input[type="checkbox"]{width:20px;height:20px;accent-color:#010b12;cursor:pointer;flex-shrink:0}
.rt-field{display:block;margin-bottom:16px}
.rt-field span{display:block;font-size:14px;font-weight:600;color:#010b12;margin-bottom:6px}
.rt-field input{width:100%;padding:12px 14px;font-size:16px;border:2px solid #c0d0b0;border-radius:0;box-sizing:border-box;outline:none;transition:border-color .2s;background:#fff}
.rt-field input:focus{border-color:#010b12}
.rt-submit:disabled{opacity:.4;cursor:not-allowed}
.rt-error{background:#fce4e4;border:2px solid #e74c3c;color:#c0392b;padding:12px 16px;margin-bottom:16px;font-size:14px}
.rt-success-block{background:#fff;border:2px solid #c0d0b0;padding:24px;text-align:center;color:#333;font-size:16px;margin-bottom:16px}
.rt-load{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(237,251,226,.95);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10}
.rt-load.rt-hide{display:none}
.rt-load p{margin-top:16px;color:#333;font-size:16px}
.rt-spin{width:48px;height:48px;border:4px solid #c0d0b0;border-top:4px solid #010b12;border-radius:50%;animation:rt-spin .8s linear infinite}
@keyframes rt-spin{to{transform:rotate(360deg)}}
</style>

<script>
(function() {
    var rtBranches = [];
    var rtSelectedBranch = null;
    var rtSelectedGroup  = null;
    var rtWebhookUrl    = '<?php echo RENDER_WEBHOOK_URL; ?>';
    var rtApiUrl        = '<?php echo RENDER_API_URL; ?>';

    function showScreen(id) {
        var screens = document.querySelectorAll('#rt-app .rt-screen');
        for (var i = 0; i < screens.length; i++) screens[i].classList.add('rt-hide');
        document.getElementById(id).classList.remove('rt-hide');
    }

    function showError(msg) {
        document.getElementById('rt-error-msg').textContent = msg;
        document.getElementById('rt-error-msg').classList.remove('rt-hide');
    }

    function hideError() {
        document.getElementById('rt-error-msg').classList.add('rt-hide');
    }

    function loadBranches() {
        fetch(rtApiUrl + '/branches')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                rtBranches = data;
                var list = document.getElementById('rt-branches-list');
                list.innerHTML = '';
                data.forEach(function(b) {
                    var btn = document.createElement('button');
                    btn.className = 'rt-btn';
                    btn.dataset.branch = b.key;
                    btn.textContent = b.name;
                    list.appendChild(btn);
                });
            });
    }

    function initForm() {
        var app = document.getElementById('rt-app');
        if (!app) { setTimeout(initForm, 200); return; }

        loadBranches();

        app.addEventListener('click', function(e) {
            var branchBtn = e.target.closest('[data-branch]');
            if (branchBtn) {
                hideError();
                rtSelectedBranch = rtBranches.find(function(b) { return b.key === branchBtn.dataset.branch; });
                var b = rtSelectedBranch;
                if (!b) return;

                document.getElementById('rt-s2-title').textContent = b.name;

                var infoDays = document.getElementById('rt-info-days');
                var infoTeacher = document.getElementById('rt-info-teacher');

                if (b.days) {
                    infoDays.innerHTML = '<strong>Дни:</strong> ' + b.days;
                    infoDays.style.display = 'flex';
                } else {
                    infoDays.style.display = 'none';
                }

                if (b.teacher) {
                    infoTeacher.innerHTML = '<strong>Преподаватель:</strong> ' + b.teacher;
                    infoTeacher.style.display = 'flex';
                } else {
                    infoTeacher.style.display = 'none';
                }

                var list = document.getElementById('rt-groups-list');
                list.innerHTML = '';

                if (!b.groups || b.groups.length === 0) {
                    list.innerHTML = '<p style="text-align:center;color:#666;">Расписание для этого филиала скоро появится.</p>';
                } else {
                    b.groups.forEach(function(g) {
                        var btn = document.createElement('button');
                        btn.className = 'rt-btn';
                        btn.dataset.group = g.key;
                        btn.textContent = g.name + '  (' + g.time + ')';
                        list.appendChild(btn);
                    });
                }
                showScreen('rt-s2');
            }

            var groupBtn = e.target.closest('[data-group]');
            if (groupBtn) {
                hideError();
                rtSelectedGroup = rtSelectedBranch.groups.find(function(g) { return g.key === groupBtn.dataset.group; });
                var b = rtSelectedBranch;
                var g = rtSelectedGroup;

                document.getElementById('rt-s3-title').textContent = b.name + ' — ' + g.name;
                document.getElementById('rt-group-info').textContent = g.time + (b.days ? ' | ' + b.days : '');
                document.getElementById('rt-rules-box').innerHTML = getRulesText(g, b);
                document.getElementById('rt-agree').checked = false;
                document.getElementById('rt-enroll-btn').disabled = true;
                document.getElementById('rt-name').value = '';
                document.getElementById('rt-phone').value = '';
                showScreen('rt-s3');
            }

            var backBtn = e.target.closest('[data-back]');
            if (backBtn) {
                hideError();
                showScreen(backBtn.dataset.back);
            }
        });

        document.getElementById('rt-agree').addEventListener('change', function() {
            document.getElementById('rt-enroll-btn').disabled = !this.checked;
        });

        document.getElementById('rt-enroll-btn').addEventListener('click', function() {
            hideError();

            var name  = document.getElementById('rt-name').value.trim();
            var phone = document.getElementById('rt-phone').value.trim();

            if (!name) { showError('Укажите имя ребёнка'); return; }
            if (!phone) { showError('Укажите телефон родителя'); return; }

            var b = rtSelectedBranch;
            var g = rtSelectedGroup;
            var comment = 'Группа: ' + g.name + ' (' + g.time + ')';

            document.getElementById('rt-load').classList.remove('rt-hide');

            fetch(rtWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    branch: b.name,
                    group: g.name,
                    name: name,
                    phone: phone,
                    comment: comment,
                }),
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                document.getElementById('rt-load').classList.add('rt-hide');
                if (data.ok) {
                    var regId = data.id;
                    document.getElementById('rt-s4-info').textContent =
                        b.name + ' — ' + g.name + ' (' + g.time + ')';

                    // Показываем ссылки группы
                    var linksDiv = document.getElementById('rt-group-links');
                    linksDiv.innerHTML = '';
                    if (g.links) {
                        var items = [];
                        try {
                            var parsed = JSON.parse(g.links);
                            if (Array.isArray(parsed)) items = parsed;
                        } catch(e) {}
                        if (items.length === 0 && g.links.trim().startsWith('http')) {
                            items = [{ label: 'Перейти', url: g.links.trim() }];
                        }
                        items.forEach(function(l) {
                            if (l.url) {
                                var a = document.createElement('a');
                                a.href = l.url;
                                a.className = 'rt-btn rt-link';
                                a.target = '_blank';
                                a.rel = 'noopener';
                                a.textContent = l.label || l.url;
                                a.addEventListener('click', function() {
                                    fetch(rtApiUrl + '/track-click', {
                                        method: 'POST',
                                        headers: {'Content-Type': 'application/json'},
                                        body: JSON.stringify({ id: regId }),
                                    }).catch(function(){});
                                });
                                linksDiv.appendChild(a);
                            }
                        });
                    }

                    showScreen('rt-s4');
                } else {
                    showError('Ошибка при отправке');
                }
            })
            .catch(function() {
                document.getElementById('rt-load').classList.add('rt-hide');
                showError('Ошибка соединения. Попробуйте позже.');
            });
        });

        document.getElementById('rt-restart').addEventListener('click', function() {
            rtSelectedBranch = null;
            rtSelectedGroup = null;
            hideError();
            loadBranches();
            showScreen('rt-s1');
        });
    }

    function getRulesText(g, b) {
        return '<p><strong>Группа:</strong> ' + g.name + '</p>' +
               '<p><strong>Время:</strong> ' + g.time + '</p>' +
               (b.days ? '<p><strong>Дни занятий:</strong> ' + b.days + '</p>' : '') +
               (b.teacher ? '<p><strong>Преподаватель:</strong> ' + b.teacher + '</p>' : '') +
               '<hr style="border:none;border-top:1px solid #c0d0b0;margin:12px 0">' +
               '<p><strong>Правила посещения:</strong></p>' +
               '<ul>' +
               '<li>Приходить за 10 минут до начала занятия.</li>' +
               '<li>Иметь сменную обувь и удобную одежду для танцев.</li>' +
               '<li>При отсутствии предупредить преподавателя заранее.</li>' +
               '<li>Соблюдать дисциплину и уважительно относиться к другим ученикам.</li>' +
               '<li>Родители ожидают ребёнка в зоне ожидания.</li>' +
               '</ul>';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initForm);
    } else {
        initForm();
    }
})();
</script>
<?php
    return ob_get_clean();
}
add_shortcode('rubitime_form', 'rubitime_form_shortcode');
