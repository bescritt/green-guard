// This is a workaround to make the facebook_malvertising submodule work with web-ext
// Since facebook_malvertising is a submodule and can't be modified to make index.ts a module,
// we need to import index.ts from the submodule in a wrapper file that can be dynamically imported
// only for chrome browser builds

import './facebook_malvertising/src/background/index';
export {};