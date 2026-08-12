(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
        const response = await originalFetch(...args);
        if (args[0].toString().includes("/api/graphql/")) {
            const clonedResponse = response.clone();
            clonedResponse.text().then((text) => {
                window.postMessage({ type: "GRAPHQL_API_RESPONSE", data: text }, "*");
            });
        }
        return response;
    };

    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(
        method: string,
        url: string | URL,
        async: boolean = true,
        username?: string | null,
        password?: string | null
    ): void {
        if (url.toString().includes("/api/graphql/")) {
            this.addEventListener("load", function() {
                window.postMessage({ type: "GRAPHQL_API_RESPONSE", data: this.responseText }, "*");
            });
        }
        originalXHROpen.call(this, method, url, async, username, password);
    };
})();