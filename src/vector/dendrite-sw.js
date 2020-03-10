// -*- coding: utf-8 -*-
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

const bundle_path = self.location.href.replace("/dendrite_sw.js", "")

const version = "0.0.2"

self.importScripts(`${bundle_path}/wasm_exec.js`,
                   `${bundle_path}/go_http_bridge.js`,
                   `${bundle_path}/sqlite_bridge.js`)

self.addEventListener('install', function(event) {
    console.log(`dendrite-sw.js: v${version} SW install`)
    // Tell the browser to kill old sw's running in other tabs and replace them with this one
    // This may cause spontaneous logouts.
    self.skipWaiting();
})

self.addEventListener('activate', function(event) {
    console.log(`dendrite-sw.js: v${version} SW activate`)
    global.process = {
        pid: 1,
        env: {
            DEBUG: "*",
        }
    };
    global.fs.stat = function(path, cb) {
        cb({
            code: "EINVAL",
        });
    }

    const config = {
        locateFile: filename => `${bundle_path}/../../sql-wasm.wasm`
    }

    event.waitUntil(
        sqlite_bridge.init(config).then(()=>{
            console.log(`dendrite-sw.js: v${version} starting dendrite.wasm...`)
            const go = new Go()
            WebAssembly.instantiateStreaming(fetch(`${bundle_path}/../../dendrite.wasm`), go.importObject).then((result) => {
                go.run(result.instance)
                // make fetch calls go through this sw - notably if a page registers a sw, it does NOT go through any sw by default
                // unless you refresh or call this function.
                console.log(`dendrite-sw.js: v${version} claiming open browser tabs`)
                self.clients.claim()
            });
        })
    )
})


self.addEventListener('fetch', function(event) {
    event.respondWith((async () => {
        // If this is a page refresh for the current page, then shunt in the new sw
        // https://github.com/w3c/ServiceWorker/issues/1238
        if (event.request.mode === "navigate" && event.request.method === "GET" && registration.waiting && (await clients.matchAll()).length < 2) {
            console.log("Forcing new sw.js into page")
            registration.waiting.postMessage('skipWaiting');
            return new Response("", {headers: {"Refresh": "0"}});
        }

        if (event.request.url.match(/\/_matrix\/client/)) {
            if (global.fetchListener) {
                console.log(`dendrite-sw.js: v${version} Forwarding ${event.request.url}`);
                const response = await global.fetchListener.onFetch(event);
                return response;
            }
            else {
                console.log(`dendrite-sw.js: v${version} no fetch listener present for ${event.request.url}`);
            }
        }
        else {
            return fetch(event.request);
        }
    })());
})
