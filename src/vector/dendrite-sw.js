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

self.importScripts(`${bundle_path}/wasm_exec.js`,
                   `${bundle_path}/go_http_bridge.js`,
                   `${bundle_path}/sqlite_bridge.js`)

self.addEventListener('install', function(event) {
    console.log("installing SW")
})

self.addEventListener('activate', function(event) {
    console.log("SW activated")

    const config = {
        locateFile: filename => `${bundle_path}/../../sql-wasm.wasm`
    }

    event.waitUntil(
        sqlite_bridge.init(config).then(()=>{
            const go = new Go()
            WebAssembly.instantiateStreaming(fetch(`${bundle_path}/../../dendrite.wasm`), go.importObject).then((result) => {
                go.run(result.instance)
            });
        })
    )
})


self.addEventListener('fetch', function(event) {
    console.log("intercepted " + event.request.method + " " + event.request.url);
    if (event.request.url.match(/\/_matrix\/client/)) {
        if (global.fetchListener) {
            event.respondWith(global.fetchListener.onFetch(event))
        }
        else {
            console.log("no fetch listener present for " + event.request.url)
        }
    }
    else {
        return fetch(event.request)
    }
})
