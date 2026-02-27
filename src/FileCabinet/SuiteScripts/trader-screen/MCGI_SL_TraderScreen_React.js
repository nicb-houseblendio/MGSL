/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Host Suitelet - serves the React Trader Screen HTML and injects NetSuite context
 */
define(['N/file', 'N/search', 'N/url', 'N/runtime', 'N/record'], function (file, search, url, runtime, record) {
    function getHtmlFileId() {
        const folderSearch = search.create({
            type: 'folder',
            filters: [['name', 'is', 'trader-screen']],
            columns: ['internalid'],
        });
        const folderResults = folderSearch.run().getRange({ start: 0, end: 1 });
        if (folderResults.length === 0) return null;
        const folderId = folderResults[0].getValue({ name: 'internalid' });
        log.debug('folderId', folderId);
        const fileSearch = search.create({
            type: 'file',
            filters: [
                ['name', 'is', 'index.html'],
                'AND',
                ['folder', 'anyof', folderId],
            ],
            columns: ['internalid'],
        });
        const fileResults = fileSearch.run().getRange({ start: 0, end: 1 });
        return fileResults.length > 0 ? fileResults[0].getValue({ name: 'internalid' }) : null;
    }

    function getContext() {
        const user = runtime.getCurrentUser();
        let subsidiaryName = 'CWP Industriel Inc.';
        if (user.subsidiary) {
            try {
                const subRec = record.load({ type: 'subsidiary', id: user.subsidiary });
                subsidiaryName = subRec.getValue({ fieldId: 'name' }) || subsidiaryName;
            } catch (e) {
                subsidiaryName = String(user.subsidiary);
            }
        }
        const returnedContext = {
            restletUrl: url.resolveScript({
                scriptId: 'customscript_mcgi_rl_traderapi',
                deploymentId: 'customdeploy_mcgi_rl_traderapi',
            }),
            userId: user.id,
            userName: user.name,
            userRole: user.role ? String(user.role) : '',
            accountId: runtime.accountId,
            subsidiary: { id: user.subsidiary, name: subsidiaryName },
        };
        log.debug('Returned Context', returnedContext);
        return returnedContext;
    }

    function getHtmlContent() {
        const fileId = getHtmlFileId();
        if (fileId) {
            try {
                const htmlFile = file.load({ id: fileId });
                return htmlFile.getContents();
            } catch (e) {
                return getFallbackHtml('Error loading HTML file: ' + e.message);
            }
        }
        return getFallbackHtml(
                'Please run "npm run build:deploy" from react-app/ then deploy. The index.html must be at SuiteScripts/trader-screen/index.html'
        );
    }

    function getFallbackHtml(message) {
        return (
                '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Trader Screen</title></head>' +
                '<body style="font-family:sans-serif;padding:2rem;"><h1>Trader Screen</h1><p>' +
                message +
                '</p><p>Build the React app with: <code>cd react-app && npm run build</code></p>' +
                '<p>Then upload dist/index.html to the File Cabinet and set HTML_FILE_ID in the Suitelet script.</p></body></html>'
        );
    }

    function onRequest(context) {
        const html = getHtmlContent();
        const nsContext = getContext();

        const contextJson = JSON.stringify(nsContext)
                .replace(/</g, '\\u003c')
                .replace(/>/g, '\\u003e');
        const output = html.replace('"REPLACE_NS_CONFIG"', contextJson);

        context.response.write({
            output: output,
        });
        context.response.contentType = 'text/html';
    }

    return {
        onRequest: onRequest,
    };
});
