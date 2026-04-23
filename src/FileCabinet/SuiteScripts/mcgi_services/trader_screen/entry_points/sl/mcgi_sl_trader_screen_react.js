/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Serves React Trader Screen in two modes:
 *   - Default: INLINEHTML inside a NetSuite form (NS nav visible, dynamic height)
 *   - Fullscreen (?fullscreen=true): raw HTML response (no NS chrome, 100vh)
 *
 * Data loading: The React app calls the RESTlet (RESTLET_SCRIPT_ID) for summary data. The RESTlet reads from
 * cache key TS_SUMMARY, which is populated by the Map/Reduce script MCGI_MR_TraderScreenCache. If no data loads,
 * (1) ensure the RESTlet script/deploy IDs below match your deployed RESTlet, and (2) run or schedule the
 * Map/Reduce script to populate the cache.
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/url', 'N/file', 'N/record', 'N/log'], (serverWidget, runtime, url, file, record, log) => {

    const RESTLET_SCRIPT_ID = 'customscript_mcgi_rl_traderapi';
    const RESTLET_DEPLOY_ID = 'customdeploy_mcgi_rl_traderapi';

    const getRestletUrl = () => url.resolveScript({
        scriptId: RESTLET_SCRIPT_ID,
        deploymentId: RESTLET_DEPLOY_ID,
    });

    const loadBundleFile = (fileName) => {
        const pathByPath = '/SuiteScripts/mcgi_services/trader_screen/react-app/dist/' + fileName;
        try {
            const f = file.load({ id: pathByPath });
            return f.getContents() || '';
        } catch (e) {
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

    const buildConfig = (isFullscreen) => {
        let restletUrl;
        try { restletUrl = getRestletUrl(); } catch (e) { restletUrl = null; }

        const user = runtime.getCurrentUser();
        let subsidiaryName = 'CWP Industriel Inc.';
        let logoUrl = '';
        if (user.subsidiary) {
            try {
                const subRec = record.load({ type: 'subsidiary', id: user.subsidiary });
                subsidiaryName = subRec.getValue({ fieldId: 'name' }) || subsidiaryName;
            } catch (err) {
                subsidiaryName = String(user.subsidiary);
            }
        }
        // Always load logo from CWP MTL subsidiary (ID 5)
        try {
            var logoSubRec = record.load({ type: 'subsidiary', id: 5 });
            var pageLogoId = logoSubRec.getValue({ fieldId: 'pagelogo' });
            if (pageLogoId) {
                try {
                    var logoFile = file.load({ id: pageLogoId });
                    logoUrl = logoFile.url || '';
                } catch (logoErr) {
                    log.debug('Logo', 'Could not load page logo file: ' + logoErr.message);
                }
            }
        } catch (logoSubErr) {
            log.debug('Logo', 'Could not load CWP MTL subsidiary: ' + logoSubErr.message);
        }

        const suiteletUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
        });

        const configObj = {
            restletUrl: restletUrl,
            suiteletUrl: suiteletUrl,
            userId: String(user.id),
            userName: user.name || '',
            accountId: runtime.accountId,
            subsidiary: { id: user.subsidiary, name: subsidiaryName },
            logoUrl: logoUrl,
            fullscreen: isFullscreen,
        };
        log.debug('Config Object', configObj);
        return JSON.stringify(configObj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    };

    /**
     * Fullscreen mode: raw HTML, no NS chrome. 100vh = entire viewport.
     */
    const buildFullscreenHTML = (configJson, reactCss) => {
        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Trader Screen</title>' +
            '<link rel="preconnect" href="https://fonts.googleapis.com">' +
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
            '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' +
            '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style>' +
            (reactCss ? '<style>' + reactCss + '</style>' : '') +
            '</head><body><div id="react-root"></div>' +
            '<script>window.MCGI_CONFIG=' + configJson + ';window.__NS_CONFIG__=window.MCGI_CONFIG;</script>' +
            getReactBundleScript() +
            '</body></html>';
    };

    /**
     * Default mode: INLINEHTML inside NS form. fullBleedScript resets width/padding on ancestors.
     */
    const buildInlineHTML = (configJson, reactCss) => {
        const fullBleedScript = '<script>(function(){function fullWidth(el){el.style.setProperty("width","100%","important");el.style.setProperty("max-width","100%","important");el.style.setProperty("margin","0","important");el.style.setProperty("padding","0","important");el.style.setProperty("box-sizing","border-box","important");}function go(){var el=document.getElementById("react-root");if(!el)return;fullWidth(el);el.style.setProperty("margin-top","-65px","important");var p=el.parentElement;while(p){fullWidth(p);p=p.parentElement;}fullWidth(document.body);fullWidth(document.documentElement);document.body.style.setProperty("overflow","hidden","important");document.documentElement.style.setProperty("overflow","hidden","important");}function run(){go();setTimeout(go,50);setTimeout(go,200);setTimeout(go,500);}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();})();<\/script>';
        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Trader Screen</title>' +
            '<link rel="preconnect" href="https://fonts.googleapis.com">' +
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
            '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' +
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
            const form = serverWidget.createForm({ title: 'Trader Screen' });
            const reactField = form.addField({
                id: 'custpage_trader_react',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' ',
            });
            reactField.defaultValue = buildInlineHTML(configJson, reactCss);
            context.response.writePage(form);
        }
    };

    return { onRequest: onRequest };
});
