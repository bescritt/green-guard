import { GenericSearchEngine } from "./searchEngine";
import { SearchEngine, Utils } from "../../BDTLLCommon";
import { Google } from "./google";
import { Yahoo } from "./yahoo";
import { YahooJp } from "./yahooJp";
import { Bing } from "./bing";
import { DuckDuckGo } from "./duckduckgo";

export class SearchEngineFactory {
    static getSearchEngineAnalyzer(): GenericSearchEngine {
        const currentDomain: SearchEngine = Utils.getDomainForLinkScan(
            document.location.href
        );

        switch (currentDomain) {
            case SearchEngine.SEARCH_GOOGLE:
                return new Google();
            case SearchEngine.SEARCH_YAHOO:
                return new Yahoo();
            case SearchEngine.SEARCH_YAHOO_JP:
                return new YahooJp();
            case SearchEngine.SEARCH_BING:
                return new Bing();
            case SearchEngine.SEARCH_DUCKDUCKGO:
                return new DuckDuckGo();
            default:
                throw new Error(`Search engine ${currentDomain} is not supported.`);
        }
    }
}