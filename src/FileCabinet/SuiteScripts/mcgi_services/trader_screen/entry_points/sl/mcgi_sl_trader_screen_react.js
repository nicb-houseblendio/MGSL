/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Serves React Trader Screen: HTML shell with bundle.js and bundle.css from File Cabinet. Injects MCGI_CONFIG.
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/url', 'N/file', 'N/search', 'N/record'], (serverWidget, runtime, url, file, search, record) => {

    const RESTLET_SCRIPT_ID = 'customscript_mcgi_rl_traderapi';
    const RESTLET_DEPLOY_ID = 'customdeploy_mcgi_rl_traderapi';

    /**
     * Resolve RESTlet URL for API calls
     * @returns {string} RESTlet URL
     */
    const getRestletUrl = () => url.resolveScript({
        scriptId: RESTLET_SCRIPT_ID,
        deploymentId: RESTLET_DEPLOY_ID,
    });

    /**
     * Find folder internal ID by name and optional parent folder id
     * @param {string} folderName - Folder name
     * @param {number} [parentId] - Parent folder internal id
     * @returns {number|null} Folder internal id or null
     */
    const findFolderId = (folderName, parentId) => {
        const filters = [['name', 'is', folderName]];
        if (parentId) {
            filters.push('and', ['parent', 'anyof', parentId]);
        }
        const s = search.create({
            type: search.Type.FOLDER,
            filters: filters,
            columns: ['internalid'],
        });
        const results = s.run().getRange({ start: 0, end: 1 });
        return results.length ? results[0].getValue({ name: 'internalid' }) : null;
    };

    /**
     * Find file internal ID by name in folder
     * @param {string} fileName - File name
     * @param {number} folderId - Folder internal id
     * @returns {number|null} File internal id or null
     */
    const findFileId = (fileName, folderId) => {
        const s = search.create({
            type: 'file',
            filters: [
                ['name', 'is', fileName],
                'and',
                ['folder', 'anyof', folderId],
            ],
            columns: ['internalid'],
        });
        const results = s.run().getRange({ start: 0, end: 1 });
        return results.length ? results[0].getValue({ name: 'internalid' }) : null;
    };

    /**
     * Load file content from File Cabinet.
     * Tries CFA-style path first (file.load by path string); falls back to search by folder hierarchy.
     * @param {string} fileName - e.g. 'bundle.js' or 'bundle.css'
     * @returns {string} File contents or empty string
     */
    const loadBundleFile = (fileName) => {
        const pathByPath = '/SuiteScripts/mcgi_services/trader_screen/react-app/dist/' + fileName;
        try {
            const f = file.load({ id: pathByPath });
            const content = f.getContents();
            if (content && content.trim().length > 0) return content;
        } catch (e) {
            // Path load not supported or file missing; fall back to search by folder
        }
        try {
            const traderFolderId = findFolderId('trader_screen');
            if (!traderFolderId) return '';
            const reactAppFolderId = findFolderId('react-app', traderFolderId);
            if (!reactAppFolderId) return '';
            const distFolderId = findFolderId('dist', reactAppFolderId);
            if (!distFolderId) return '';
            const fileId = findFileId(fileName, distFolderId);
            if (!fileId) return '';
            const f = file.load({ id: fileId });
            return f.getContents() || '';
        } catch (e) {
            return '';
        }
    };

    /**
     * Get React bundle script tag (inline script with bundle.js content)
     * @returns {string} <script>...</script> or fallback message script
     */
    const getReactBundleScript = () => {
        const content = loadBundleFile('bundle.js');
        if (content && content.trim().length > 0) {
            return '<script>' + content + '</script>';
        }
        return '<script>document.getElementById("react-root").innerHTML="<p style=\\"padding:20px;font-family:sans-serif;\\">Bundle not found. Run <code>npm run build</code> from react-app and deploy dist/bundle.js to File Cabinet at SuiteScripts/mcgi_services/trader_screen/react-app/dist/.</p>";</script>';
    };

    /**
     * Get React CSS content (raw CSS for bundle.css)
     * @returns {string} Raw CSS or empty string
     */
    const getReactCSS = () => loadBundleFile('bundle.css');

    /**
     * Build HTML shell with fonts, styles, react-root, MCGI_CONFIG, and bundle script
     * @returns {string} Full HTML string
     */
    const getReactHTMLShell = () => {
        let restletUrl;
        try {
            restletUrl = getRestletUrl();
        } catch (e) {
            restletUrl = null;
        }

        const user = runtime.getCurrentUser();
        let subsidiaryName = 'CWP Industriel Inc.';
        if (user.subsidiary) {
            try {
                const subRec = record.load({ type: 'subsidiary', id: user.subsidiary });
                subsidiaryName = subRec.getValue({ fieldId: 'name' }) || subsidiaryName;
            } catch (err) {
                subsidiaryName = String(user.subsidiary);
            }
        }

        const suiteletUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
        });

        const reactCss = getReactCSS();
        const configObj = {
            restletUrl: restletUrl,
            suiteletUrl: suiteletUrl,
            userId: String(user.id),
            userName: user.name || '',
            accountId: runtime.accountId,
            subsidiary: { id: user.subsidiary, name: subsidiaryName },
        };
        const configJson = JSON.stringify(configObj)
                .replace(/</g, '\\u003c')
                .replace(/>/g, '\\u003e');

        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>Trader Screen</title>' +
                '<link rel="preconnect" href="https://fonts.googleapis.com">' +
                '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
                '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' +
                (reactCss ? '<style>' + reactCss + '</style>' : '') +
                '</head><body><div id="react-root"></div>' +
                '<script>window.MCGI_CONFIG=' + configJson + ';window.__NS_CONFIG__=window.MCGI_CONFIG;</script>' +
                getReactBundleScript() +
                '</body></html>';
    };

    const onRequest = context => {
        if (context.request.method !== 'GET') {
            context.response.write(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        const form = serverWidget.createForm({ title: 'Trader Screen' });
        const reactField = form.addField({
            id: 'custpage_trader_react',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
        });
        reactField.defaultValue = getReactHTMLShell();
        context.response.writePage(form);
    };

    return { onRequest: onRequest };
});
