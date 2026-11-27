<?php
/**
 * Plugin Name: Rural Value Engine Sync
 * Description: Notifies the Rural Value Engine when routes, businesses or points of interest change, so the app shows updates within seconds.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

final class RVE_Sync {
    const OPTION = 'rve_sync_settings';
    const TYPES = ['business', 'route', 'pois'];

    public static function init(): void {
        add_action('save_post', [__CLASS__, 'on_save'], 20, 3);
        add_action('transition_post_status', [__CLASS__, 'on_status'], 20, 3);
        add_action('before_delete_post', [__CLASS__, 'on_delete'], 10, 1);
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
    }

    private static function settings(): array {
        $s = get_option(self::OPTION, []);
        return [
            'endpoint' => isset($s['endpoint']) ? rtrim((string) $s['endpoint'], '/') : '',
            'secret'   => isset($s['secret']) ? (string) $s['secret'] : '',
        ];
    }

    public static function on_save(int $post_id, WP_Post $post, bool $update): void {
        if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
            return;
        }
        if (!in_array($post->post_type, self::TYPES, true) || $post->post_status !== 'publish') {
            return;
        }
        self::notify($post->post_type, $post_id, 'upsert');
    }

    public static function on_status(string $new, string $old, WP_Post $post): void {
        if (!in_array($post->post_type, self::TYPES, true)) {
            return;
        }
        if ($old === 'publish' && $new !== 'publish') {
            self::notify($post->post_type, $post->ID, 'delete');
        }
    }

    public static function on_delete(int $post_id): void {
        $type = get_post_type($post_id);
        if ($type && in_array($type, self::TYPES, true)) {
            self::notify($type, $post_id, 'delete');
        }
    }

    private static function notify(string $type, int $id, string $action): void {
        $s = self::settings();
        if ($s['endpoint'] === '' || $s['secret'] === '') {
            return;
        }
        $body = wp_json_encode(['type' => $type, 'id' => $id, 'action' => $action]);
        wp_remote_post($s['endpoint'] . '/v1/webhooks/wordpress', [
            'timeout'  => 5,
            'blocking' => false, // never slow down saving in wp-admin
            'headers'  => [
                'Content-Type'    => 'application/json',
                'X-RVE-Signature' => hash_hmac('sha256', $body, $s['secret']),
            ],
            'body'     => $body,
        ]);
    }

    public static function menu(): void {
        add_options_page('Rural Value Engine', 'Rural Value Engine', 'manage_options', 'rve-sync', [__CLASS__, 'page']);
    }

    public static function register_settings(): void {
        register_setting('rve_sync', self::OPTION, [
            'type'              => 'array',
            'sanitize_callback' => function ($v) {
                return [
                    'endpoint' => esc_url_raw(trim($v['endpoint'] ?? '')),
                    'secret'   => sanitize_text_field($v['secret'] ?? ''),
                ];
            },
        ]);
    }

    public static function page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = self::settings();
        ?>
        <div class="wrap">
            <h1>Rural Value Engine</h1>
            <p>When a route, business or point of interest is published, updated or removed, this site tells the engine so the app updates straight away. The engine also re-reads everything every night.</p>
            <form method="post" action="options.php">
                <?php settings_fields('rve_sync'); ?>
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="rve-endpoint">Engine URL</label></th>
                        <td><input id="rve-endpoint" class="regular-text" type="url" name="<?php echo esc_attr(self::OPTION); ?>[endpoint]" value="<?php echo esc_attr($s['endpoint']); ?>" placeholder="https://engine.example.gr"></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="rve-secret">Shared secret</label></th>
                        <td><input id="rve-secret" class="regular-text" type="password" name="<?php echo esc_attr(self::OPTION); ?>[secret]" value="<?php echo esc_attr($s['secret']); ?>" autocomplete="off">
                        <p class="description">Same value as WP_WEBHOOK_SECRET on the engine.</p></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}

RVE_Sync::init();
