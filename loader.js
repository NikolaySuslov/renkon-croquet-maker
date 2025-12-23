import {ProgramState} from "./renkon-core.js";
import {loader} from "./croquet.js";

export {ProgramState, globals} from "./renkon-core.js";
export {CodeMirrorModel, CodeMirrorView, CodeMirror} from "./codemirror.js";

function basenames() {
  let url = window.location.origin + window.location.pathname;
  let match = /([^/]+)\.html$/.exec(url);
  let basename = new URL(window.location).searchParams.get("world");

  if (!basename) {
    basename = (!match || match[1] === "index") ? "index" : match[1];
  }

  let baseurl;
  if (match) {
    baseurl = url.slice(0, match.index);
  } else {
    let slash = url.lastIndexOf("/");
    baseurl = url.slice(0, slash + 1);
  }

  return {baseurl, basename};
}

function isRunningLocalNetwork() {
  let hostname = window.location.hostname;

  if (/^\[.*\]$/.test(hostname)) {
    hostname = hostname.slice(1, hostname.length - 1);
  }

  let local_patterns = [
    /^localhost$/,
    /^.*\.local$/,
    /^.*\.ngrok.io$/,
    // 10.0.0.0 - 10.255.255.255
    /^(::ffff:)?10(?:\.\d{1,3}){3}$/,
    // 127.0.0.0 - 127.255.255.255
    /^(::ffff:)?127(?:\.\d{1,3}){3}$/,
    // 169.254.1.0 - 169.254.254.255
    /^(::f{4}:)?169\.254\.([1-9]|1?\d\d|2[0-4]\d|25[0-4])\.\d{1,3}$/,
    // 172.16.0.0 - 172.31.255.255
    /^(::ffff:)?(172\.1[6-9]|172\.2\d|172\.3[01])(?:\.\d{1,3}){2}$/,
    // 192.168.0.0 - 192.168.255.255
    /^(::ffff:)?192\.168(?:\.\d{1,3}){2}$/,
    // fc00::/7
    /^f[cd][\da-f]{2}(::1$|:[\da-f]{1,4}){1,7}$/,
    // fe80::/10
    /^fe[89ab][\da-f](::1$|:[\da-f]{1,4}){1,7}$/,
    // ::1
    /^::1$/,
  ];

  for (let i = 0; i < local_patterns.length; i++) {
    if (local_patterns[i].test(hostname)) {return true;}
  }

  return false;
}

async function loadApiKey() {
  let local = isRunningLocalNetwork();
  let apiKeysFile = local ? "apiKey-dev.js" : "apiKey.js";
  let {baseurl} = basenames();

  try {
    // use eval to hide import from webpack
    const apiKeysModule = await eval(`import('${baseurl}${apiKeysFile}')`);
    return apiKeysModule.default;
  } catch (error) {
    return;
    /*
    if (error.name === "TypeError" && local) {
      return;
    } else {
      console.error(error);
      console.log("Please make sure that you have created a valid apiKey-dev.js for local development, and apiKey.js for deployment (see croquet.io/keys)");
      }
    */
  }
}

export async function launcher() {
  const {basename} = basenames();
  const url = new URL(window.location);
  const padOption = url.searchParams.get("pad");

  let docName = `${basename}.renkon`;
  if (padOption) {
    if (padOption.endsWith(".json") || padOption.endsWith(".renkon")) {
      docName = padOption;
    } else {
      console.log("pad option does not have .renkon suffix.")
      return;
    }
  }

  const options = {appParameters: {}};
  const q = url.searchParams.get("q");

  let apiKeyParameters;
  try {
    apiKeyParameters = await loadApiKey();
  } catch (e) {
  }

  if (q) {
    if (q === "offline") {
      options.appParameters.name = "abc";
      options.appParameters.password = "123";
      options.debug = ["offline"];
    } else {
      options.appParameters.name = q;
      if (url.hash && url.hash.startsWith("#pw=")) {
        options.appParameters.password = url.hash.slice("#pw=".length) || "abc";
      }
    }
  }

  options.appParameters = {...options.appParameters, ...apiKeyParameters};

  loader(docName, ProgramState, options);
}
