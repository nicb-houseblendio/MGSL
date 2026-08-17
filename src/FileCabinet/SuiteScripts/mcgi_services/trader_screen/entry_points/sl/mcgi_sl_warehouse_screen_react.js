/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Serves the CWP ARCH Warehouse screen (bundle-split queue) as its
 *              OWN page, separate from the Trader Screen.
 *
 * Why a second Suitelet rather than a tab or a ?screen= parameter on the trader
 * one: access differs. "Le gars dans l'entrepôt, on veut pas nécessairement
 * qu'il ait le trader screen, mais qu'il ait juste l'écran ici"
 * (Marc-Antoine, 2026-08-11). A script deployment is the unit NetSuite lets you
 * restrict by role, so two screens with different audiences need two
 * deployments. A URL parameter would have been trivially bypassable — anyone
 * with the trader screen could drop the parameter and vice versa.
 *
 * It sets MCGI_CONFIG.screen = 'warehouse'; App.tsx routes on that and mounts
 * WarehouseSplitScreen with no NetSuiteProvider, so this page never touches
 * trader data or subsidiary context.
 *
 * ⚠️ The two screens still SHARE ONE BUNDLE, so warehouse users are served the
 * trader code even though they cannot reach it. That is a payload and
 * source-disclosure concern, not an access one. If it matters, split the Vite
 * build into two entry points — the component boundary is already clean.
 *
 * ⚠️ The deployment currently has allemployees=T so it can be demoed. It MUST be
 * restricted to the warehouse role before production — that role is still an
 * open question with Marc-Antoine.
 *
 * Lives under trader_screen/ because it loads that folder's bundle and is
 * therefore covered by the same deploy.xml files path. Move both together.
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/file', 'N/log', 'N/url'], (serverWidget, runtime, file, log, url) => {

    const loadBundleFile = (fileName) => {
        const path = '/SuiteScripts/mcgi_services/trader_screen/react-app/dist/' + fileName;
        try {
            const f = file.load({ id: path });
            return f.getContents() || '';
        } catch (e) {
            log.error('Warehouse Screen', 'Could not load ' + fileName + ': ' + e.message);
            return '';
        }
    };

    const getReactBundleScript = () => {
        const content = loadBundleFile('bundle.js');
        if (content && content.trim().length > 0) {
            return '<script>' + content + '</script>';
        }
        return '<script>document.getElementById("react-root").innerHTML="<p style=\\"padding:20px;font-family:sans-serif;\\">Bundle not found. Run <code>npm run build</code> from react-app and deploy.</p>";</script>';
    };

    const getReactCSS = () => loadBundleFile('bundle.css');

    /**
     * No restletUrl and no subsidiary: the warehouse screen reads none of the
     * trader cache. userId/userName are carried because completing a split needs
     * to record who did it once this writes to NetSuite.
     */
    const buildConfig = (isFullscreen) => {
        const user = runtime.getCurrentUser();
        // Where the screen reads its queue and posts completions. Resolved rather
        // than hardcoded so the same bundle works in any account, and passed in
        // rather than derived in the browser: the front end has no business
        // guessing a Suitelet URL, and if this is absent it correctly falls back
        // to fixtures instead of firing requests at a URL it invented.
        let splitEndpointUrl = '';
        try {
            splitEndpointUrl = url.resolveScript({
                scriptId:   'customscript_mcgi_sl_arch_split_execute',
                deploymentId: 'customdeploy_mcgi_sl_arch_split_execute',
                returnExternalUrl: false,
            });
        } catch (e) {
            log.error('Warehouse Screen',
                'Could not resolve the split endpoint, the screen will fall back to demo data: ' + e.message);
        }

        const configObj = {
            screen: 'warehouse',
            userId: String(user.id),
            userName: user.name || '',
            accountId: runtime.accountId,
            fullscreen: isFullscreen,
            splitEndpointUrl: splitEndpointUrl,
        };
        return JSON.stringify(configObj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    };

    const HEAD = '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Warehouse — Bundle Splits</title>' +
        '<link rel="preconnect" href="https://fonts.googleapis.com">' +
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
        '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">';

    const buildFullscreenHTML = (configJson, reactCss) => {
        return '<!DOCTYPE html><html lang="en"><head>' + HEAD +
            '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style>' +
            (reactCss ? '<style>' + reactCss + '</style>' : '') +
            '</head><body><div id="react-root"></div>' +
            '<script>window.MCGI_CONFIG=' + configJson + ';window.__NS_CONFIG__=window.MCGI_CONFIG;</script>' +
            getReactBundleScript() +
            '</body></html>';
    };

    /**
     * Inline mode keeps NetSuite navigation. The full-bleed shim is the same one
     * the trader Suitelet uses: NS wraps INLINEHTML in a padded, width-capped
     * form, so the ancestors have to be reset or the screen renders in a column.
     *
     * The trader screen's -65px top offset is deliberately NOT copied — it pulls
     * content up under the NS header to hide the form title bar, and this screen
     * has its own header that would be clipped by it.
     */
    const buildInlineHTML = (configJson, reactCss) => {
        const fullBleedScript = '<script>(function(){function fullWidth(el){el.style.setProperty("width","100%","important");el.style.setProperty("max-width","100%","important");el.style.setProperty("margin","0","important");el.style.setProperty("padding","0","important");el.style.setProperty("box-sizing","border-box","important");}function go(){var el=document.getElementById("react-root");if(!el)return;fullWidth(el);var p=el.parentElement;while(p){fullWidth(p);p=p.parentElement;}fullWidth(document.body);fullWidth(document.documentElement);}function run(){go();setTimeout(go,50);setTimeout(go,200);setTimeout(go,500);}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();})();<\/script>';
        return '<!DOCTYPE html><html lang="en"><head>' + HEAD +
            (reactCss ? '<style>' + reactCss + '</style>' : '') +
            '</head><body><div id="react-root"></div>' +
            fullBleedScript +
            '<script>window.MCGI_CONFIG=' + configJson + ';window.__NS_CONFIG__=window.MCGI_CONFIG;</script>' +
            getReactBundleScript() +
            '</body></html>';
    };

    const onRequest = context => {
        if (context.request.method !== 'GET') {
            context.response.write(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        const isFullscreen = context.request.parameters.fullscreen === 'true';
        const configJson = buildConfig(isFullscreen);
        const reactCss = getReactCSS();

        if (isFullscreen) {
            context.response.write(buildFullscreenHTML(configJson, reactCss));
        } else {
            const form = serverWidget.createForm({ title: 'Warehouse — Bundle Splits' });
            const reactField = form.addField({
                id: 'custpage_warehouse_react',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' ',
            });
            reactField.defaultValue = buildInlineHTML(configJson, reactCss);
            context.response.writePage(form);
        }
    };

    return { onRequest: onRequest };
});
