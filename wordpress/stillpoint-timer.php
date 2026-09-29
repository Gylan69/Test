<?php
/**
 * Plugin Name: Stillpoint Timer
 * Description: A self-contained countdown, stopwatch, and Pomodoro timer. Add it with the [stillpoint_timer] shortcode.
 * Version: 1.0.0
 * License: GPL-2.0-or-later
 * Text Domain: stillpoint-timer
 */

if (!defined('ABSPATH')) {
    exit;
}

function stillpoint_timer_shortcode() {
    $url = plugins_url('dist/index.html', __FILE__);
    $id = 'stillpoint-timer-' . wp_unique_id();

    ob_start();
    ?>
    <iframe
        id="<?php echo esc_attr($id); ?>"
        title="<?php echo esc_attr__('Stillpoint focus timer', 'stillpoint-timer'); ?>"
        src="<?php echo esc_url($url); ?>"
        loading="lazy"
        allow="autoplay"
        style="display:block;width:100%;height:720px;border:0;"
    ></iframe>
    <script>
    (function () {
        var frame = document.getElementById(<?php echo wp_json_encode($id); ?>);
        var expectedOrigin = new URL(frame.src).origin;
        window.addEventListener('message', function (event) {
            if (event.origin !== expectedOrigin || event.source !== frame.contentWindow) return;
            if (!event.data || event.data.type !== 'stillpoint:height') return;
            var height = Number(event.data.height);
            if (Number.isFinite(height) && height >= 320 && height <= 5000) {
                frame.style.height = Math.ceil(height) + 'px';
            }
        });
    }());
    </script>
    <?php
    return ob_get_clean();
}

add_shortcode('stillpoint_timer', 'stillpoint_timer_shortcode');