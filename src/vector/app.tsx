/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2017 Vector Creations Ltd
Copyright 2018, 2019 New Vector Ltd
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from 'react';
// add React and ReactPerf to the global namespace, to make them easier to access via the console
// this incidentally means we can forget our React imports in JSX files without penalty.
window.React = React;

import * as sdk from 'matrix-react-sdk';
import PlatformPeg from 'matrix-react-sdk/src/PlatformPeg';
import { _t, _td, newTranslatableError } from 'matrix-react-sdk/src/languageHandler';
import AutoDiscoveryUtils from 'matrix-react-sdk/src/utils/AutoDiscoveryUtils';
import { AutoDiscovery } from "matrix-js-sdk/src/autodiscovery";
import * as Lifecycle from "matrix-react-sdk/src/Lifecycle";
import type MatrixChatType from "matrix-react-sdk/src/components/structures/MatrixChat";
import { MatrixClientPeg } from 'matrix-react-sdk/src/MatrixClientPeg';
import SdkConfig from "matrix-react-sdk/src/SdkConfig";

// P2P only, probably should be relocated
import Modal from 'matrix-react-sdk/src/Modal';
import { IDialogProps } from 'matrix-react-sdk/src/components/views/dialogs/IDialogProps';
import dis from 'matrix-react-sdk/src/dispatcher/dispatcher';
import { getCachedRoomIDForAlias } from 'matrix-react-sdk/src/RoomAliasCache';
import { Room } from "matrix-js-sdk/src/models/room";

import { parseQs, parseQsFromFragment } from './url_utils';
import VectorBasePlatform from "./platform/VectorBasePlatform";
import { createClient } from "matrix-js-sdk/src/matrix";

let lastLocationHashSet: string = null;

// Parse the given window.location and return parameters that can be used when calling
// MatrixChat.showScreen(screen, params)
function getScreenFromLocation(location: Location) {
    const fragparts = parseQsFromFragment(location);
    return {
        screen: fragparts.location.substring(1),
        params: fragparts.params,
    };
}

// Here, we do some crude URL analysis to allow
// deep-linking.
function routeUrl(location: Location) {
    if (!window.matrixChat) return;

    console.log("Routing URL ", location.href);
    const s = getScreenFromLocation(location);
    (window.matrixChat as MatrixChatType).showScreen(s.screen, s.params);
}

function onHashChange(ev: HashChangeEvent) {
    if (decodeURIComponent(window.location.hash) === lastLocationHashSet) {
        // we just set this: no need to route it!
        return;
    }
    routeUrl(window.location);
}

// This will be called whenever the SDK changes screens,
// so a web page can update the URL bar appropriately.
function onNewScreen(screen: string, replaceLast = false) {
    console.log("newscreen " + screen);
    const hash = '#/' + screen;
    lastLocationHashSet = hash;

    if (replaceLast) {
        window.location.replace(hash);
    } else {
        window.location.assign(hash);
    }

    if (!window.matrixChat) {
        return;
    }
    let creds = null;
    if (screen === "register" || screen === "login" || screen === "welcome") {
        autoRegister().then((newCreds) => {
            creds = newCreds;
            return (window.matrixChat as MatrixChatType).onUserCompletedLoginFlow(
                newCreds, "-",
            );
        }, (err) => {
            console.error("Failed to auto-register:", err);
        }).then(() => {
            // first time user
            if (creds._registered) {
                p2pFirstTimeSetup();
            }
        });
    } else if (screen.startsWith("room/")) {
        // room/!foo:bar
        // room/#foo:bar
        // if this room is public then make sure it is published.
        p2pEnsurePublished(screen.split("/")[1]);
    }
}

const P2PDisplayNameDialog: React.FC<IDialogProps> = ({ onFinished }) => {
    const BaseDialog = sdk.getComponent('views.dialogs.BaseDialog');
    const ChangeDisplayName = sdk.getComponent('settings.ChangeDisplayName');
    const DialogButtons = sdk.getComponent('views.elements.DialogButtons');

    return <BaseDialog
        onFinished={onFinished}
        title={_t('Set a display name:')}
    >
        <ChangeDisplayName onFinished={onFinished} />
        <DialogButtons
            primaryButton={_t('OK')}
            onPrimaryButtonClick={onFinished}
            hasCancel={false}
        />
    </BaseDialog>;
};

function p2pFirstTimeSetup() {
    // Prompt them to set a display name
    Modal.createDialog(P2PDisplayNameDialog,
        {
            onFinished: () => {
                // View the room directory after display name has been sorted out
                dis.dispatch({
                    action: 'view_room_directory',
                });
            },
        }, null, /* priority = */ false, /* static = */ true,
    );
}

async function fetchRoom(roomId: string): Room {
    const client = MatrixClientPeg.get();
    let room = client.getRoom(roomId);
    if (room) {
        return room;
    }
    console.log("p2pEnsurePublished fetchRoom waiting for room... ", roomId);
    room = await new Promise((resolve, reject) => {
        let fulfilled = false;
        const cb = function(room) {
            if (fulfilled) {
                return;
            }
            const newRoomId = room.roomId;
            if (roomId === newRoomId) {
                fulfilled = true;
                console.log("p2pEnsurePublished fetchRoom found ", roomId);
                resolve(room);
            }
        };
        client.on("Room", cb);
        setTimeout(() => {
            if (fulfilled) {
                return;
            }
            console.log("p2pEnsurePublished fetchRoom timed out ", roomId);
            fulfilled = true;
            client.removeListener("Room", cb);
            reject(new Error("timed out waiting to see room " + roomId));
        }, 60 * 1000); // wait 60s
    });
    return room;
}

async function p2pEnsurePublished(roomIdOrAlias: string) {
    // If the room has just been created, we need to wait for the join_rules to come down /sync
    // If the app has just been refreshed, we need to wait for the DB to be loaded.
    // Since we don't really care when this is done, just sleep a bit.
    await sleep(3000);
    console.log("p2pEnsurePublished ", roomIdOrAlias);
    try {
        const client = MatrixClientPeg.get();
        // convert alias to room ID
        let roomId;
        let aliasLocalpart;
        if (roomIdOrAlias.startsWith("!")) {
            roomId = roomIdOrAlias;
        } else {
            roomId = getCachedRoomIDForAlias(roomIdOrAlias);
            // extract the localpart so we can republish this alias on our server
            aliasLocalpart = roomIdOrAlias.split(":")[0].substring(1);
        }

        // fetch the join_rules, check if public
        const room = await fetchRoom(roomId);
        if (!room) {
            throw new Error("No room for room ID: " + roomId);
        }
        if (!aliasLocalpart) {
            const roomName = room.currentState.getStateEvents("m.room.name", "");
            if (roomName) {
                aliasLocalpart = roomName.getContent().name;
                // room alias grammar is poorly defined. Synapse rejects whitespace, Riot barfs on slashes, it's a mess.
                // so for now, let's just do A-Za-z0-9_-
                aliasLocalpart = aliasLocalpart.replace(/[^A-Za-z0-9_-]/g, "");
            } else {
                // use the random part of the room ID as a fallback.
                aliasLocalpart = roomId.split(":")[0].substring(1);
            }
        }

        const joinRules = room.currentState.getStateEvents("m.room.join_rules", "");
        if (!joinRules) {
            throw new Error("No join_rules for room ID: " + roomId);
        }
        const isPublic = joinRules.getContent().join_rule === "public";

        if (isPublic) {
            // make sure that there is an alias mapping
            try {
                for (let i = 0; i < 2; i++) {
                    const newRoomAlias = `#${aliasLocalpart}:${client.getDomain()}`;
                    let exists = false;
                    let matches = false;
                    try {
                        const aliasResponse = await client.getRoomIdForAlias(newRoomAlias);
                        matches = aliasResponse.room_id === roomId;
                        exists = true;
                    } catch (err) {}
                    console.log(
                        "p2pEnsurePublished: room ID:", roomId, " want alias: ", newRoomAlias,
                        " exists=", exists, " matches=", matches,
                    );
                    if (!exists) {
                        await client.createAlias(newRoomAlias, roomId);
                        break;
                    } else if (!matches) {
                        // clashing room alias, use the room ID.
                        aliasLocalpart = roomId.split(":")[0].substring(1);
                    } else {
                        // exists and matches, do nothing
                        break;
                    }
                }
            } catch (err) {
                console.log("p2pEnsurePublished: problem creating alias: ", err);
            }

            // publish the room
            await client.setRoomDirectoryVisibility(roomId, "public");
            console.log("p2pEnsurePublished: Now published.");
        } else {
            // unpublish the room
            await client.setRoomDirectoryVisibility(roomId, "private");
            console.log("p2pEnsurePublished: Now hidden.");
        }
    } catch (err) {
        console.log("p2pEnsurePublished encountered an error: ", err);
    }
}

// We use this to work out what URL the SDK should
// pass through when registering to allow the user to
// click back to the client having registered.
// It's up to us to recognise if we're loaded with
// this URL and tell MatrixClient to resume registration.
//
// If we're in electron, we should never pass through a file:// URL otherwise
// the identity server will try to 302 the browser to it, which breaks horribly.
// so in that instance, hardcode to use app.element.io for now instead.
function makeRegistrationUrl(params: object) {
    let url;
    if (window.location.protocol === "vector:") {
        url = 'https://app.element.io/#/register';
    } else {
        url = (
            window.location.protocol + '//' +
            window.location.host +
            window.location.pathname +
            '#/register'
        );
    }

    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; ++i) {
        if (i === 0) {
            url += '?';
        } else {
            url += '&';
        }
        const k = keys[i];
        url += k + '=' + encodeURIComponent(params[k]);
    }
    return url;
}

function onTokenLoginCompleted() {
    // if we did a token login, we're now left with the token, hs and is
    // url as query params in the url; a little nasty but let's redirect to
    // clear them.
    const url = new URL(window.location.href);

    url.searchParams.delete("loginToken");

    console.log(`Redirecting to ${url.href} to drop loginToken from queryparams`);
    window.history.replaceState(null, "", url.href);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoRegister() {
    console.log("dendrite: Auto-registration in progress");
    const cli = createClient({
        baseUrl: window.location.origin,
    });
    const password = "this should be really really secure";

    // Make sure the server is up (active service worker)
    await navigator.serviceWorker.ready;
    // On Firefox, the ready promise resolves just prior to activation.
    // On Chrome, the ready promise resolves just after activation.
    // We need to make requests AFTER we have been activated, else the /register request
    // will fail.
    await sleep(10);

    let response = null;
    let didRegister = false;
    try {
        response = await cli.registerRequest({
            username: "p2p",
            password,
            auth: {
                type: "m.login.dummy",
            },
        });
        console.log("dendrite: Auto-registration done ", response);
        didRegister = true;
    } catch (err) {
        console.error("dendrite: failed to register, trying to login:", err);
        response = await cli.login("m.login.password", {
            identifier: {
                type: "m.id.user",
                user: "p2p",
            },
            password,
            initial_device_display_name: "p2p-dendrite",
        });
    }

    return {
        userId: response.user_id,
        deviceId: response.device_id,
        homeserverUrl: cli.getHomeserverUrl(),
        identityServerUrl: cli.getIdentityServerUrl(),
        accessToken: response.access_token,
        guest: cli.isGuest(),
        _registered: didRegister,
    };
}

export async function loadApp(fragParams: {}) {
    // XXX: the way we pass the path to the worker script from webpack via html in body's dataset is a hack
    // but alternatives seem to require changing the interface to passing Workers to js-sdk
    const vectorIndexeddbWorkerScript = document.body.dataset.vectorIndexeddbWorkerScript;
    if (!vectorIndexeddbWorkerScript) {
        // If this is missing, something has probably gone wrong with
        // the bundling. The js-sdk will just fall back to accessing
        // indexeddb directly with no worker script, but we want to
        // make sure the indexeddb script is present, so fail hard.
        throw newTranslatableError(_td("Missing indexeddb worker script!"));
    }
    // MatrixClientPeg.setIndexedDbWorkerScript(vectorIndexeddbWorkerScript);

    // load dendrite, if available
    const vectorDendriteWorkerScript = document.body.dataset.vectorDendriteWorkerScript;
    if (vectorDendriteWorkerScript && 'serviceWorker' in navigator) {
        console.log("dendrite code exec... ", document.readyState);
        const loadDendriteSw = () => {
            console.log("Registering dendrite sw...", vectorDendriteWorkerScript);
            console.log("swjs: invoke navigator.serviceWorker.register");
            navigator.serviceWorker.register(vectorDendriteWorkerScript, { scope: "/" }).then(function(registration) {
                console.log("swjs: navigator.serviceWorker.register resolved", registration);
                // Registration was successful
                console.log('ServiceWorker sw.js registration successful with scope: ', registration.scope);
                // periodically check for updates
                setInterval(function() {
                    console.log("swjs invoke registration.update");
                    registration.update();
                }, 1000 * 60 * 30); // once every 30 minutes
            }, (err) => {
                // registration failed :(
                console.log('dendrite: ServiceWorker registration failed: ', err);
            });
            // First, do a one-off check if there's currently a
            // service worker in control.
            if (navigator.serviceWorker.controller) {
                console.log('dendrite: This page is currently controlled by:', navigator.serviceWorker.controller);
            }

            // Then, register a handler to detect when a new or
            // updated service worker takes control.
            navigator.serviceWorker.oncontrollerchange = function() {
                console.log('dendrite: This page is now controlled by:', navigator.serviceWorker.controller);
            };
        };
        if (document.readyState === "loading") {
            window.addEventListener('DOMContentLoaded', loadDendriteSw);
        } else {
            loadDendriteSw();
        }
    }

    window.addEventListener('hashchange', onHashChange);

    const platform = PlatformPeg.get();

    const params = parseQs(window.location);

    const urlWithoutQuery = window.location.protocol + '//' + window.location.host + window.location.pathname;
    console.log("Vector starting at " + urlWithoutQuery);

    (platform as VectorBasePlatform).startUpdater();

    // Don't bother loading the app until the config is verified
    const config = await verifyServerConfig();

    // Before we continue, let's see if we're supposed to do an SSO redirect
    const [userId] = await Lifecycle.getStoredSessionOwner();
    const hasPossibleToken = !!userId;
    const isReturningFromSso = !!params.loginToken;
    const autoRedirect = config['sso_immediate_redirect'] === true;
    if (!hasPossibleToken && !isReturningFromSso && autoRedirect) {
        console.log("Bypassing app load to redirect to SSO");
        const tempCli = createClient({
            baseUrl: config['validated_server_config'].hsUrl,
            idBaseUrl: config['validated_server_config'].isUrl,
        });
        PlatformPeg.get().startSingleSignOn(tempCli, "sso", `/${getScreenFromLocation(window.location).screen}`);

        // We return here because startSingleSignOn() will asynchronously redirect us. We don't
        // care to wait for it, and don't want to show any UI while we wait (not even half a welcome
        // page). As such, just don't even bother loading the MatrixChat component.
        return;
    }

    const MatrixChat = sdk.getComponent('structures.MatrixChat');
    return <MatrixChat
        onNewScreen={onNewScreen}
        makeRegistrationUrl={makeRegistrationUrl}
        config={config}
        realQueryParams={params}
        startingFragmentQueryParams={fragParams}
        enableGuest={!config.disable_guests}
        onTokenLoginCompleted={onTokenLoginCompleted}
        initialScreenAfterLogin={getScreenFromLocation(window.location)}
        defaultDeviceDisplayName={platform.getDefaultDeviceDisplayName()}
    />;
}

async function verifyServerConfig() {
    let validatedConfig;
    try {
        console.log("Verifying homeserver configuration");

        // Note: the query string may include is_url and hs_url - we only respect these in the
        // context of email validation. Because we don't respect them otherwise, we do not need
        // to parse or consider them here.

        // Note: Although we throw all 3 possible configuration options through a .well-known-style
        // verification, we do not care if the servers are online at this point. We do moderately
        // care if they are syntactically correct though, so we shove them through the .well-known
        // validators for that purpose.

        const config = SdkConfig.get();
        let wkConfig = config['default_server_config']; // overwritten later under some conditions
        const serverName = config['default_server_name'];
        const hsUrl = config['default_hs_url'];
        const isUrl = config['default_is_url'];

        const incompatibleOptions = [wkConfig, serverName, hsUrl].filter(i => !!i);
        if (incompatibleOptions.length > 1) {
            // noinspection ExceptionCaughtLocallyJS
            throw newTranslatableError(_td(
                "Invalid configuration: can only specify one of default_server_config, default_server_name, " +
                "or default_hs_url.",
            ));
        }
        if (incompatibleOptions.length < 1) {
            // noinspection ExceptionCaughtLocallyJS
            throw newTranslatableError(_td("Invalid configuration: no default server specified."));
        }

        if (hsUrl) {
            console.log("Config uses a default_hs_url - constructing a default_server_config using this information");
            console.warn(
                "DEPRECATED CONFIG OPTION: In the future, default_hs_url will not be accepted. Please use " +
                "default_server_config instead.",
            );

            wkConfig = {
                "m.homeserver": {
                    "base_url": hsUrl,
                },
            };
            if (isUrl) {
                wkConfig["m.identity_server"] = {
                    "base_url": isUrl,
                };
            }
        }

        let discoveryResult = null;
        if (wkConfig) {
            console.log("Config uses a default_server_config - validating object");
            discoveryResult = await AutoDiscovery.fromDiscoveryConfig(wkConfig);
        }

        if (serverName) {
            console.log("Config uses a default_server_name - doing .well-known lookup");
            console.warn(
                "DEPRECATED CONFIG OPTION: In the future, default_server_name will not be accepted. Please " +
                "use default_server_config instead.",
            );
            discoveryResult = await AutoDiscovery.findClientConfig(serverName);
        }

        validatedConfig = AutoDiscoveryUtils.buildValidatedConfigFromDiscovery(serverName, discoveryResult, true);
    } catch (e) {
        const { hsUrl, isUrl, userId } = await Lifecycle.getStoredSessionVars();
        if (hsUrl && userId) {
            console.error(e);
            console.warn("A session was found - suppressing config error and using the session's homeserver");

            console.log("Using pre-existing hsUrl and isUrl: ", { hsUrl, isUrl });
            validatedConfig = await AutoDiscoveryUtils.validateServerConfigWithStaticUrls(hsUrl, isUrl, true);
        } else {
            // the user is not logged in, so scream
            throw e;
        }
    }

    validatedConfig.isDefault = true;

    // Just in case we ever have to debug this
    console.log("Using homeserver config:", validatedConfig);

    // Add the newly built config to the actual config for use by the app
    console.log("Updating SdkConfig with validated discovery information");
    SdkConfig.add({ "validated_server_config": validatedConfig });

    return SdkConfig.get();
}
