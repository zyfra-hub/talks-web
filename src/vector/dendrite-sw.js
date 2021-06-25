// Copyright 2020 The Matrix.org Foundation C.I.C.
// Copyright 2020 New Vector Ltd
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Dendrite Service Worker version
// Bumping the patch version of this has no side-effects.
// Bumping the minor version of this will delete databases.
const version = "0.2.0";

const isVersionBump = function(oldVer, newVer) {
    oldVer = oldVer || "";
    const newSegments = newVer.split(".");
    const oldSegments = oldVer.split(".");
    if (oldSegments.length != 3) {
        return true; // brand new
    }
    return newSegments[1] > oldSegments[1];
}

const bundle_path = self.location.href.replace("/dendrite_sw.js", "")
const id = Math.random();
console.log("swjs: ", id," dendrite-sw.js file running...")
self.registration.addEventListener('updatefound', () => {
    console.log("swjs: ", id," updatefound registration event fired")
    const newWorker = self.registration.installing;
    if (!newWorker) {
        console.log("swjs: ", id," updatefound registration event fired, no installing worker")
        return;
    }
    newWorker.addEventListener('statechange', () => {
        console.log("swjs: ", id," worker statechange: ", newWorker.state)
    });
})

self.importScripts(`${bundle_path}/wasm_exec.js`,
                   `${bundle_path}/sqlitejs.js`,
                   `${bundle_path}/localforage.js`);

let isWriting = false;
async function writeDatabasesToIndexedDB() {
    while (true) {
        await sleep(1000 * 30);
        try {
            await syncfs(false);
        }
        catch (err) {
            console.error("syncfs: failed to write to IDB:", err);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function syncfs(isStartup) {
    return new Promise((resolve, reject) => {
        global._go_sqlite.FS.syncfs(isStartup, function(err) {
            if (err) {
                console.error("syncfs failed:", err);
                reject(err);
                return;
            }
            console.log("syncfs OK");
            resolve();
        });
    });
}

function deleteDatabase(name) {
    return new Promise(function(resolve, reject) {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = function () {
            console.log("Deleted database successfully: ", name);
            resolve();
        };
        req.onerror = function (event) {
            console.log("Couldn't delete database: ", name, event);
            reject(new Error("failed to delete database"));
        };
    });
}

async function initDendrite() {
    console.log(`dendrite-sw.js: v${version} SW init`)
    // check if we need to purge databases (minor version bump)
    const prevVer = await global.localforage.getItem("dendrite_version")
    if (prevVer != version) {
        const nukeDatabase = isVersionBump(prevVer, version);
        console.log(`dendrite-sw.js: previous ver ${prevVer} current ${version} nuke databases: ${nukeDatabase}`);
        if (nukeDatabase) {
            await deleteDatabase("/idb");
        }
    }

    global.process = {
        pid: 1,
        env: {
            DEBUG: "*",
        }
    };
    // we do this for prometheus so it doesn't panic on init()
    global.fs.stat = function(path, cb) {
        cb({
            code: "EINVAL",
        });
    }

    const config = {
        locateFile: filename => `${bundle_path}/../../sql-wasm.wasm`
    }
    
    const go = new Go();
    await sqlitejs.init(config);

    // periodically write databases to disk
    if (!isWriting) {
        isWriting = true;
        // have to do this before we start dendrite for hopefully obvious reasons...
        console.log("syncfs", global._go_sqlite.IDBFS);
        global._go_sqlite.FS.mkdir("/idb");
        //global._go_sqlite.FS.unmount("/");
        console.log("syncfs at /idb mkdir ok");
        global._go_sqlite.FS.mount(global._go_sqlite.IDBFS, {}, "/idb");
        console.log("syncfs mounted");
        await syncfs(true); // load from IDB
        writeDatabasesToIndexedDB();
    }

    console.log(`dendrite-sw.js: v${version} starting dendrite.wasm...`)
    const result = await WebAssembly.instantiateStreaming(fetch(`${bundle_path}/../../dendrite.wasm`), go.importObject)
    go.run(result.instance).then(() => {
        console.log(`dendrite-sw.js: v${version} dendrite.wasm terminated, restarting...`);
        // purge databases and p2p nodes.
        global._go_js_server = undefined;
        global._go_sqlite_dbs.clear();
        initDendritePromise = initDendrite();
    });
    // make fetch calls go through this sw - notably if a page registers a sw, it does NOT go through any sw by default
    // unless you refresh or call this function.
    console.log(`dendrite-sw.js: v${version} claiming open browser tabs`)
    console.log("swjs: ", id," invoke self.clients.claim()")
    self.clients.claim();

    let serverIsUp = false;
    for (let i = 0; i < 30; i++) { // 3s
        if (global._go_js_server) {
            console.log("swjs: ", id," init dendrite promise resolving");
            serverIsUp = true;
            break;
        }
        await sleep(100);
    }
    if (!serverIsUp) {
        throw new Error("Timed out waiting for _go_js_server to be set.");
    }
    // persist the new version
    await global.localforage.setItem("dendrite_version", version);
}

let initDendritePromise = initDendrite();

self.addEventListener('install', function(event) {
    console.log("swjs: ", id," install event fired:", event)
    console.log(`dendrite-sw.js: v${version} SW install`)
    // Tell the browser to kill old sw's running in other tabs and replace them with this one
    // This may cause spontaneous logouts.
    console.log("swjs: ", id," invoke self.skipWaiting")
    self.skipWaiting();
})

self.addEventListener('activate', function(event) {
    console.log("swjs: ", id," activate event fired")
    console.log(`dendrite-sw.js: v${version} SW activate`)
    event.waitUntil(initDendritePromise)
})

async function sendRequestToGo(event) {
    await initDendritePromise; // this sets the global fetch listener
    if (!global._go_js_server || !global._go_js_server.fetch) {
        console.log(`dendrite-sw.js: v${version} no fetch listener present for ${event.request.url}`);
        return
    }
    console.log(`dendrite-sw.js: v${version} forwarding ${event.request.url} to Go`);
    const req = event.request
    let reqHeaders = ''
    if (req.headers) {
        for (const header of req.headers) {
            // FIXME: is this a safe header encoding?
            reqHeaders += `${header[0]}: ${header[1]}\n`
        }
    }
    let jj = null;
    if (req.method === "POST" || req.method === "PUT") {
        jj = await req.json();
        jj = JSON.stringify(jj);
        reqHeaders += `Content-Length: ${new Blob([jj]).size}`; // include utf-8 chars properly
    }

    if (reqHeaders.length > 0) {
        reqHeaders = `\r\n${reqHeaders}`
    }

    // Replace the timeout value for /sync calls to be 20s not 30s because Firefox
    // will aggressively cull service workers after a 30s idle period. Chrome doesn't.
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=1378587
    const fullurl = req.url.replace("timeout=30000", "timeout=20000");
    
    const reqString = `${req.method} ${fullurl} HTTP/1.0${reqHeaders}\r\n\r\n${jj ? jj : ''}`

    const res = await global._go_js_server.fetch(reqString)
    if (res.error) {
        console.error(`dendrite-sw.js: v${version} Error for request: ${event.request.url} => ${res.error}`)
        return
    }
    const respString = res.result;

    const m = respString.match(/^(HTTP\/1.[01]) ((.*?) (.*?))(\r\n([^]*?)?(\r\n\r\n([^]*?)))?$/)
    if (!m) {
        console.warn("couldn't parse resp", respString);
        return;
    }
    const response = {
        "proto": m[1],
        "status": m[2],
        "statusCode": parseInt(m[3]),
        "headers": m[6],
        "body": m[8],
    }

    const respHeaders = new Headers()
    const headerLines = response.headers.split('\r\n')
    for (const headerLine of headerLines) {
        // FIXME: is this safe header parsing? Do we need to worry about line-wrapping?
        const match = headerLine.match(/^(.+?): *(.*?)$/)
        if (match) {
            respHeaders.append(match[1], match[2])
        }
        else {
            console.log("couldn't parse headerLine ", headerLine)
        }
    }

    return new Response(response.body, {
        status: response.statusCode,
        headers: respHeaders,
    })
}

self.addEventListener('fetch', function(event) {
    event.respondWith((async () => {
        /*
        // If this is a page refresh for the current page, then shunt in the new sw
        // https://github.com/w3c/ServiceWorker/issues/1238
        if (event.request.mode === "navigate" && event.request.method === "GET" && registration.waiting && (await clients.matchAll()).length < 2) {
            console.log("Forcing new sw.js into page")
            registration.waiting.postMessage('skipWaiting');
            return new Response("", {headers: {"Refresh": "0"}});
        } */

        if (event.request.url.match(/\/_matrix\/client/)) {
            return await sendRequestToGo(event);
        }
        else {
            return fetch(event.request);
        }
    })());
})
