# Stillpoint for WordPress

This package installs the existing Stillpoint timer as a WordPress plugin. The timer runs in an iframe on your own WordPress site, so its styles cannot change your theme. It does not need a separate Replit deployment.

## Install

1. Download `stillpoint-timer.zip`.
2. In a WordPress installation that supports plugins, go to **Plugins → Add New → Upload Plugin** and upload the ZIP, then activate it.
3. Add a **Shortcode** block to a page and enter `[stillpoint_timer]`. Publish or update that page.

The timer remembers its state in that browser's local storage for this site. It does **not** sync between devices or use Supabase. Existing data saved under a different site address will not automatically appear on the WordPress site. Browsers may restrict notifications or audio until a visitor interacts with the timer.

The plugin serves a static HTML file from its `dist/` directory. If your hosting provider blocks direct access to HTML files inside plugins, this package will not display; that host needs to allow the file or use a different hosting approach.

## Rebuild after changes to the app

From the workspace root, run `bash scripts/package-stillpoint-wordpress.sh`. This rebuilds the timer with relative asset URLs and packages the ZIP under `exports/`.