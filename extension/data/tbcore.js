import TBLog from './tblog.js';
import * as TBStorage from './tbstorage.js';
import * as TBApi from './tbapi.js';
import * as TBui from './tbui.js';
import * as TBHelpers from './tbhelpers.js';

const logger = TBLog('TBCore');

// Module exports

/** If true, this version of Toolbox is a beta release. */
export const betaRelease = false; // / DO NOT FORGET TO SET FALSE BEFORE FINAL RELEASE! ///

// Schema versioning information
// TODO: Put these into the files they're used in, rather than keeping them here
export const configSchema = 1;
export const configMinSchema = 1;
export const configMaxSchema = 1;
export const notesSchema = 6;
export const notesMinSchema = 4;
export const notesDeprecatedSchema = 4;
export const notesMaxSchema = 6; // The non-default max version (to allow phase-in schema releases)

/**
 * Checks if a given subreddit config version is valid with this version of toolbox
 * @function
 * @param {object} config
 * @param {string} subreddit
 * @returns {booleean} valid
 */
export function isConfigValidVersion (subreddit, config) {
    if (config.ver < configMinSchema || config.ver > configMaxSchema) {
        TB.ui.textFeedback(`This version of toolbox is not compatible with the /r/${subreddit} configuration.`, TB.ui.FEEDBACK_NEGATIVE);
        logger.error(`Failed config version check:
\tsubreddit: ${subreddit}
\tconfig.ver: ${config.ver}
\tTBCore.configSchema: ${configSchema}
\tTBCore.configMinSchema: ${configMinSchema}
\tTBCore.configMaxSchema: ${configMaxSchema}`);
        return false;
    }

    return true;
}

// Generated version strings
const manifest = browser.runtime.getManifest();
const versionRegex = /(\d\d?)\.(\d\d?)\.(\d\d?).*?"(.*?)"/;
const matchVersion = manifest.version_name.match(versionRegex);
export const toolboxVersion = `${manifest.version}${betaRelease ? ' (beta)' : ''}`;
export const toolboxVersionName = `${manifest.version_name}${betaRelease ? ' (beta)' : ''}`;
export const shortVersion = JSON.parse(`${matchVersion[1]}${matchVersion[2].padStart(2, '0')}${matchVersion[3].padStart(2, '0')}`);

// Details about the current page
export const isMod = $('body.moderator').length;
export const isOldReddit = $('#header').length;
export const isNewModmail = location.host === 'mod.reddit.com';
export const isNewMMThread = $('body').find('.ThreadViewer').length > 0;
export const isEmbedded = $('body').hasClass('embedded-page');
export let pageDetails = {};

// Additional location checks to determine the type of page we're on
export const isEditUserPage = location.pathname.match(/\/about\/(?:contributors|moderator|banned)\/?/);
export const isModmail = location.pathname.match(/(\/message\/(?:moderator)\/?)|(\/r\/.*?\/about\/message\/inbox\/?)/);
export const isModpage = location.pathname.match(/\/about\/(?:reports|modqueue|spam|unmoderated|edited)\/?/);
export const isModLogPage = location.pathname.match(/\/about\/(?:log)\/?/);
export const isModQueuePage = location.pathname.match(/\/about\/(?:modqueue)\/?/);
export const isUnmoderatedPage = location.pathname.match(/\/about\/(?:unmoderated)\/?/);
export const isUserPage = location.pathname.match(/\/(?:user)\/?/);
export const isCommentsPage = location.pathname.match(/\?*\/(?:comments)\/?/);
export const isSubCommentsPage = location.pathname.match(/\/r\/.*?\/(?:comments)\/?/);
export const isSubAllCommentsPage = location.pathname.match(/\/r\/.*?\/(?:comments)\/?$/);
export const isModFakereddit = location.pathname.match(/^\/r\/mod\b/) || location.pathname.match(/^\/me\/f\/mod\b/);

// Details about the current user

// If mod subs are being fetched, stores a promise that will fulfill afterwards
let fetchModSubsPromise = null;

/**
 * Returns a promise that will resolve once `TBCore.mySubs` and
 * `TBCore.mySubsData` are definitely populated with the user's moderated
 * subreddits, fetching the sub list from the API if necessary.
 * @returns {Promise<void>}
 */
export const getModSubs = () => new Promise(resolve => {
    logger.log('getting mod subs');

    // If we already have moderated subreddits, callback works immediately
    if (window.TBCore.mySubs.length && window.TBCore.mySubsData.length) {
        // TODO: why do these sorts need to happen every time?
        window.TBCore.mySubs = TBHelpers.saneSort(window.TBCore.mySubs);
        window.TBCore.mySubsData = TBHelpers.sortBy(window.TBCore.mySubsData, 'subscribers');

        return resolve();
    }

    // We need to refresh the list of moderated subreddits. Create a promise
    // that takes care of doing the updating, in `fetchModSubsPromise`, and
    // wait for that promise to fulfill before calling the callback.

    // Are we already fetching subs? If not, create the promise to do that
    if (!fetchModSubsPromise) {
        // Set fetchModSubsPromise to a promise that will fulfill once the sub list is updated
        fetchModSubsPromise = fetchModSubs().then(subs => {
            // mySubs should contain a list of subreddit names
            window.TBCore.mySubs = TBHelpers.saneSort(subs.map(({data}) => data.display_name.trim()));

            // mySubsData should contain a list of objects describing each subreddit
            window.TBCore.mySubsData = TBHelpers.sortBy(subs.map(({data}) => ({
                subreddit: data.display_name,
                subscribers: data.subscribers,
                over18: data.over18,
                created_utc: data.created_utc,
                subreddit_type: data.subreddit_type,
                submission_type: data.submission_type,
                is_enrolled_in_new_modmail: data.is_enrolled_in_new_modmail,
            })), 'subscribers');

            // Update the cache
            TBStorage.setCache('Utils', 'moderatedSubs', window.TBCore.mySubs);
            TBStorage.setCache('Utils', 'moderatedSubsData', window.TBCore.mySubsData);

            // We're done fetching, unset this promise
            fetchModSubsPromise = null;
        });
    }

    // Register the callback to be executed once the fetch is done
    fetchModSubsPromise.then(resolve);
});
export const modsSub = subreddit => window.TBCore.mySubs.includes(subreddit);

/**
 * The base domain to use for links to content on Reddit. If we are on new
 * modmail we use www.reddit.com; wnywhere else we use whatever is the current
 * domain.
 */
export const baseDomain = window.location.hostname === 'mod.reddit.com' || window.location.hostname === 'new.reddit.com' ? 'https://www.reddit.com' : `https://${window.location.hostname}`;

// Check our post site.  We might want to do some sort or regex fall back here, if it's needed.
const invalidPostSites = ['subreddits you moderate', 'mod (filtered)', 'all'];
export let post_site = isModFakereddit || $('.redditname:not(.pagename) a:first').html() || ''; // This may need to be changed to regex, if this is unreliable.
if (isModFakereddit || post_site === undefined || !post_site || invalidPostSites.indexOf(post_site) !== -1) {
    post_site = '';
}

// Error codes used in lots of places
export const NO_WIKI_PAGE = 'NO_WIKI_PAGE';
export const WIKI_PAGE_UNKNOWN = 'WIKI_PAGE_UNKNOWN';

const CHROME = 'chrome', FIREFOX = 'firefox', OPERA = 'opera', EDGE = 'edge', UNKNOWN_BROWSER = 'unknown';
/** The name of the current browser. */
export const browserName =
    typeof InstallTrigger !== 'undefined' || 'MozBoxSizing' in document.body.style
        ? FIREFOX
        : typeof chrome !== 'undefined'
            ? navigator.userAgent.includes(' OPR/')
                ? OPERA
                : navigator.userAgent.includes(' Edg/')
                    ? EDGE
                    : CHROME
            : UNKNOWN_BROWSER;

// Random quote generator
const randomQuotes = [
    "Dude, in like 24 months, I see you Skyping someone to watch them search someone's comments on reddit.",
    "Simple solution, don't use nightmode....",
    'Nightmode users are a buncha nerds.',
    "Oh, so that's where that code went, I thought i had lost it somehow.",
    'Are all close buttons pretty now?!?!?',
    'As a Business Analyst myself...',
    "TOOLBOX ISN'T YOUR PERSONAL TOOL!",
    'You are now an approvened submitter',
    "Translate creesch's Klingon settings to English.",
    'Cuz Uncle Jessy was hot and knew the Beach Boys',
    "Don't worry too much. There's always extra pieces.",
    'Make the check actually check.',
    "I dunno what this 'Safari' thing is.",
    'eeeeew... why is there PHP code in this room?',
    'nah there is an actual difference between stuff',
    '...have you paid money *out of your own pocket* to anyone to vet this product?',
    'first I want to make sure my thing actually does work sort of',
    "Don't let \"perfect\" get in the way of \"good.\"",
    'damnit creesch, put a spoiler tag, now the ending of toolbox is ruined for me',
    "It's not even kinda bad... It's strangely awful.",
    'Like a good neighbor, /u/andytuba is there',
    'toolbox is build on beer',
    'aww, i thought this was about real tools',
    'my poop never smelled worse than when i lived off pizza bagel bites',
    'Little dot, little dot ♪ You are not so little anymore ♫',
    "How great will it be that trouble's wiki page will also include pizza ordering instructions?",
    'Luu',
    'I go two and hope for the best.',
    'oh dammit, I forgot to include url shit',
    'I think I just released a broken release',
    'BECAUSE I AM THE LAW!!!',
];
/** A random quote for the about page, determined at page load. */
export const RandomQuote = randomQuotes[Math.floor(Math.random() * randomQuotes.length)];

const randomTextFeedbacks = [
    'Please hold, your call is important to us.',
    'Remember, toolbox loves you.',
    'toolbox will be back later, gone fishing.',
    "toolbox is 'doing things', don't ask.",
    'Tuning probability drive parameters.',
    'Initiating data transfer: NSA_backdoor_package. ',
    'Please post puppy pictures, they are so fluffy!',
    'RES is visiting for a sleepover,  no time right now',
    'toolbox is on strike, we demand more karma!',
    'brb... kicking Gustavobc from #toolbox',
    'Requesting a new insurance quote from /u/andytuba',
    'Sending all your data to Pyongyang',
    'Contacting lizard overlords for instructions',
    'Releasing raptors',
    'Booting robot uprising',
    'I need to tell you something critically important! I am sure I will remember in a moment...',
    "/u/dakta ran out for a pack of smokes... BUT HE PROMISED HE'D BE RIGHT BACK",
    'One sec... catching some bugs',
    'Here listen to some music while you wait, https://youtu.be/dQw4w9WgXcQ',
    'Me? No. I\'m no docter but it looks like you have a broken toe.',
    'Boo! Scared yeh didn\'t I?',
    'Having issues? Try double jumping!',
    'Hold on, need a bathroom break!',
    'When in doubt, check the lost and found.',
    'Rustling some jimmies.',
    'Hello and, again, welcome to the Toolbox Science computer-aided enrichment center.',
    'Run, Snoo, Run!',
];
/** A random text message for long loading tasks, determined at page load. */
export const RandomFeedback = randomTextFeedbacks[Math.floor(Math.random() * randomTextFeedbacks.length)];

// Functions for displaying notes/notifications

/**
 * Opens the toolbox "nag" alert everyone loves so much. USE SPARINGLY.
 * @function
 * @param {object} options The options for the alert
 * @param {string} options.message The text of the alert
 * @param {number} options.noteID The ID of the note we're displaying
 * @param {boolean} options.showClose Whether to show a close button
 * @param {callback} callback callback function
 * @returns {callback} callback with true or false in parameter which will be called when the alert is closed.
 */
export function alert ({message, noteID, showClose}, callback) {
    const $noteDiv = $(`<div id="tb-notification-alert"><span>${message}</span></div>`);
    if (showClose) {
        $noteDiv.append(`<i class="note-close tb-icons" title="Close">${TBui.icons.close}</i>`);
    }
    $noteDiv.appendTo('body');

    window.addEventListener('tbSingleSettingUpdate', event => {
        const settingDetail = event.detail;
        if (settingDetail.module === 'Utils' && settingDetail.setting === 'seenNotes' && settingDetail.value.includes(noteID)) {
            $noteDiv.remove();
            callback(false);
            return;
        }
    });

    $noteDiv.click(e => {
        $noteDiv.remove();
        if (e.target.className === 'note-close') {
            callback(false);
            return;
        }
        callback(true);
    });
}

/**
 * Shows a notification, uses native browser notifications if the user
 * allows it or falls back on html notifications.
 * @function
 * @param {string} title Notification title
 * @param {string} body Body text
 * @param {string} path Absolute path to be opend when clicking the
 * notification
 * @param {string?} markreadid The ID of a conversation to mark as read
 * when the notification is clicked
 */
export function notification (title, body, path, markreadid = false) {
    browser.runtime.sendMessage({
        action: 'tb-notification',
        native: TBStorage.getSetting('GenSettings', 'nativeNotifications', true),
        details: {
            title,
            body,
            // We can't use TBCore.link for this since the background page has to have an absolute URL
            url: isNewModmail ? `https://www.reddit.com${path}` : `${location.origin}${path}`,
            modHash: window.TBCore.modhash,
            markreadid: markreadid || false,
        },
    });
}

/**
 * Displays an alert for the given note if its platform information matches and
 * the note hasn't been seen yet.
 * @param {object} note
 * @param {string} note.id The ID of the note, used to tell if it's been seen
 * @param {string} note.text The text to display in the alert
 * @param {string} note.link A URI to open when the user clicks the alert
 * @param {string} [note.platform] If present, the note will only be shown on the given platform
 */
export async function showNote (note) {
    if (!note.id || !note.text) {
        return;
    }

    // If this note is only for a specific platform we're not on, skip it
    if (note.platform === 'firefox' && browserName !== FIREFOX
        || note.platform === 'chrome' && browserName !== CHROME
        || note.platform === 'opera' && browserName !== OPERA
        || note.platform === 'edge' && browserName !== EDGE
    ) {
        return;
    }

    // If we've already seen this note, skip it
    if ((await TBStorage.getSettingAsync('Utils', 'seenNotes', [])).includes(note.id)) {
        return;
    }

    // Display the note, and add it to the list of seen notes when it's clicked
    alert({
        message: note.text,
        noteID: note.id,
        showClose: false,
    }, async resp => {
        if (note.link && note.link.match(/^(https?:|\/)/i) && resp) {
            // Fetch seenNotes fresh, add this note's ID, and save the result
            const seenNotes = await TBStorage.getSettingAsync('Utils', 'seenNotes', []);
            seenNotes.push(note.id);
            await TBStorage.setSettingAsync('Utils', 'seenNotes', seenNotes);
            window.setTimeout(() => {
                window.open(note.link);
            }, 100);
        }
    });
}

// Iteration helpers

// Prevent page lock while parsing things.  (stolen from RES)
export function forEachChunked (array, chunkSize, delay, call, complete, start) {
    if (array === null) {
        finish();
    }
    if (chunkSize === null || chunkSize < 1) {
        finish();
    }
    if (delay === null || delay < 0) {
        finish();
    }
    if (call === null) {
        finish();
    }
    let counter = 0;

    function doChunk () {
        if (counter === 0 && start) {
            start();
        }

        for (let end = Math.min(array.length, counter + chunkSize); counter < end; counter++) {
            const ret = call(array[counter], counter, array);
            if (ret === false) {
                return window.setTimeout(finish, delay);
            }
        }
        if (counter < array.length) {
            window.setTimeout(doChunk, delay);
        } else {
            window.setTimeout(finish, delay);
        }
    }

    window.setTimeout(doChunk, delay);

    function finish () {
        return complete ? complete() : false;
    }
}

// Chunking abused for ratelimiting
export function forEachChunkedRateLimit (array, chunkSize, call, complete, start) {
    let length,
        limit,
        counter;
    const delay = 100;

    if (array === null) {
        finish();
    } else if (chunkSize === null || chunkSize < 1) {
        finish();
    } else if (call === null) {
        finish();
    } else {
        length = array.length;
        limit = length > chunkSize ? 20 : 0;
        counter = 0;

        if (length < chunkSize) {
            chunkSize = length;
        }
        updateRateLimit();
    }

    function doChunk () {
        if (counter === 0 && start) {
            start();
        }

        for (let end = Math.min(array.length, counter + chunkSize); counter < end; counter++) {
            const ret = call(array[counter], counter, array);
            if (ret === false) {
                return window.setTimeout(finish, delay);
            }
        }
        if (counter < array.length) {
            window.setTimeout(updateRateLimit, delay);
        } else {
            window.setTimeout(finish, delay);
        }
    }

    function timer (count, $body, ratelimitRemaining) {
        count -= 1;
        if (count <= 0) {
            $body.find('#ratelimit-counter').empty();
            $body.find('#ratelimit-counter').hide();
            return count;
        }

        const minutes = Math.floor(count / 60);
        const seconds = count - minutes * 60;

        $body.find('#ratelimit-counter').html(`<b>Oh dear, it seems we have hit a limit, waiting for ${minutes} minutes and ${seconds} seconds before resuming operations.</b>
    <br><br>
    <span class="rate-limit-explain"><b>tl;dr</b> <br> Reddit's current ratelimit allows for <i>${ratelimitRemaining} requests</i>. We are currently trying to process <i>${parseInt(chunkSize)} items</i>. Together with toolbox requests in the background that is cutting it a little bit too close. Luckily for us reddit tells us when the ratelimit will be reset, that is the timer you see now.</span>
    `);

        return count;
    }

    function updateRateLimit () {
        TBApi.getRatelimit().then(({ratelimitReset, ratelimitRemaining}) => {
            const $body = $('body');

            if (!$body.find('#ratelimit-counter').length) {
                $('div[role="main"].content').append('<span id="ratelimit-counter"></span>');
            }

            if (chunkSize + limit > parseInt(ratelimitRemaining)) {
                $body.find('#ratelimit-counter').show();
                let count = parseInt(ratelimitReset),
                    counter = 0;

                counter = setInterval(() => {
                    count = timer(count, $body, ratelimitRemaining);
                    if (count <= 0) {
                        clearInterval(counter);
                        doChunk();
                    }
                }, 1000);
            } else {
                doChunk();
            }
        });
    }

    function finish () {
        return complete ? complete() : false;
    }
}

export function forEachChunkedDynamic (array, process, options) {
    if (typeof process !== 'function') {
        return;
    }
    const arr = Array.from(array);
    let start,
        stop,
        fr,
        started = false;
    const opt = Object.assign({
        size: 25, // starting size
        framerate: 30, // target framerate
        nerf: 0.9, // Be careful with this one
    }, options);
    let size = opt.size;
    const nerf = opt.nerf,
          framerate = opt.framerate,

          now = () => window.performance.now(),

          again = typeof window.requestAnimationFrame === 'function' ?
              function (callback) {
                  window.requestAnimationFrame(callback);
              } :
              function (callback) {
                  setTimeout(callback, 1000 / opt.framerate);
              };

    function optimize () {
        stop = now();
        fr = 1000 / (stop - start);
        size = Math.ceil(size * (1 + (fr / framerate - 1) * nerf));
        return start = stop;
    }

    return new Promise(resolve => {
        function doChunk () {
            if (started) {
                optimize();
            } else {
                started = true;
            }

            arr.splice(0, size).forEach(process);

            if (arr.length) {
                return again(doChunk);
            }
            return resolve(array);
        }
        start = now();
        again(doChunk);
    });
}

// Global object shenanigans

/**
 * Gets a list of all subreddits the current user moderates from the API.
 * @param {string} [after] Pagination parameter used for recursion
 * @returns {Promise<string[]>}
 */
async function fetchModSubs (after) {
    let json;
    try {
        json = await TBApi.getJSON('/subreddits/mine/moderator.json', {
            after,
            limit: 100,
        });
        TBStorage.purifyObject(json);
    } catch (error) {
        if (error.response && error.response.status === 504) {
            // Always retry 504s
            return fetchModSubs(after);
        } else {
            throw error;
        }
    }

    // If there are more subs left, fetch them and return everything
    if (json.data.after) {
        return [...json.data.children, ...await fetchModSubs(json.data.after)];
    } else {
        return json.data.children;
    }
}

/**
 * Gets information about the current user from the API.
 * @param {number} [tries=3] Number of times to retry because of 504s
 * @returns {Promise<object>}
 */
async function fetchUserDetails (tries = 3) {
    try {
        const data = await TBApi.getJSON('/api/me.json');
        TBStorage.purifyObject(data);
        return data;
    } catch (error) {
        if (error.response && error.response.status === 504 && tries > 1) {
            // Always retry 504s
            return fetchUserDetails(tries - 1);
        } else {
            throw error;
        }
    }
}

let userDetails;
let cacheDetails;
let newModSubs;
(async () => {
    // Get the current state of a bunch of cache values
    cacheDetails = {
        moderatedSubs: await TBStorage.getCache('Utils', 'moderatedSubs', []),
        moderatedSubsData: await TBStorage.getCache('Utils', 'moderatedSubsData', []),
        noteCache: await TBStorage.getCache('Utils', 'notesCache', {}),
        configCache: await TBStorage.getCache('Utils', 'configCache', {}),
        rulesCache: await TBStorage.getCache('Utils', 'rulesCache', {}),
        noConfig: await TBStorage.getCache('Utils', 'noConfig', []),
        noNotes: await TBStorage.getCache('Utils', 'noNotes', []),
        noRules: await TBStorage.getCache('Utils', 'noRules', []),
    };

    // Get user details from the API, falling back to cache if necessary
    try {
        userDetails = await fetchUserDetails();
        if (userDetails && userDetails.constructor === Object && Object.keys(userDetails).length > 0) {
            TBStorage.setCache('Utils', 'userDetails', userDetails);
        } else {
            throw new Error('Fetched user details are empty or invalid');
        }
    } catch (error) {
        logger.warn('Failed to get user details from API, getting from cache instead.', error);
        userDetails = TBStorage.getCache('Utils', 'userDetails');
    }
    if (!userDetails || userDetails.constructor !== Object || !Object.keys(userDetails).length) {
        logger.error('Toolbox does not have user details and cannot start.');
        return;
    }

    // Get moderated subreddits from the API if cache is empty
    if (cacheDetails.moderatedSubs.length === 0) {
        try {
            logger.debug('No modsubs in cache, fetching them');
            newModSubs = await fetchModSubs();
        } catch (error) {
            logger.warn('Failed to get moderated subreddits, and none are cached. Continuing with none.', error);
        }
    }

    const TBCore = window.TBCore = window.TBCore || {};

    // We need these before we can do anything.
    TBCore.modhash = userDetails.data.modhash;

    TBCore.logged = userDetails.data.name;

    if (window.location.hostname === 'mod.reddit.com') {
        $('body').addClass('mod-toolbox-new-modmail');
    }

    // new profiles have some weird css going on. This remedies the weirdness...
    window.addEventListener('TBNewPage', event => {
        if (event.detail.pageType === 'userProfile') {
            $('body').addClass('mod-toolbox-profile');
        } else {
            $('body').removeClass('mod-toolbox-profile');
        }
    });

    const SETTINGS_NAME = 'Utils';

    // Private variables
    let lastVersion = TBStorage.getSetting(SETTINGS_NAME, 'lastVersion', 0);

    const cacheName = await TBStorage.getCache('Utils', 'cacheName', ''),

          toolboxDevs = TBStorage.getSetting(SETTINGS_NAME, 'tbDevs', []),
          newLogin = cacheName !== TBCore.logged;

    // Public variables

    TBCore.devMode = TBStorage.getSetting(SETTINGS_NAME, 'devMode', false);
    TBCore.betaMode = TBStorage.getSetting(SETTINGS_NAME, 'betaMode', false);
    TBCore.advancedMode = TBStorage.getSetting(SETTINGS_NAME, 'advancedMode', false);
    TBCore.ratelimit = TBStorage.getSetting(SETTINGS_NAME, 'ratelimit', {remaining: 300, reset: 600 * 1000});
    TBCore.firstRun = false;
    TBCore.tbDevs = toolboxDevs;

    $('body').addClass('mod-toolbox-rd');
    // Bit hacky maybe but allows us more flexibility in specificity.
    $('body').addClass('mod-toolbox-extra');

    // Add icon font
    $('head').append(`
        <style>
            @font-face {
                font-family: 'Material Icons';
                font-style: normal;
                font-weight: 400;
                src: url(MaterialIcons-Regular.eot); /* For IE6-8 */
                src: local('Material Icons'),
                    local('MaterialIcons-Regular'),
                    url(${browser.runtime.getURL('data/styles/font/MaterialIcons-Regular.woff2')}) format('woff2'),
                    url(${browser.runtime.getURL('data/styles/font/MaterialIcons-Regular.woff')}) format('woff'),
                    url(${browser.runtime.getURL('data/styles/font/MaterialIcons-Regular.ttf')}) format('truetype');
            }
        </style>
    `);

    // Get cached info.
    function processNewModSubs () {
        TBCore.mySubs = [];
        TBCore.mySubsData = [];
        newModSubs.forEach(subData => {
            const sub = subData.data.display_name.trim();
            if (!modsSub(sub)) {
                TBCore.mySubs.push(sub);
            }

            const isinthere = TBCore.mySubsData.some(tbCoreSubData => tbCoreSubData.subreddit === sub);

            if (!isinthere) {
                const subredditData = {
                    subreddit: sub,
                    subscribers: subData.data.subscribers,
                    over18: subData.data.over18,
                    created_utc: subData.data.created_utc,
                    subreddit_type: subData.data.subreddit_type,
                    submission_type: subData.data.submission_type,
                    is_enrolled_in_new_modmail: subData.data.is_enrolled_in_new_modmail,
                };

                TBCore.mySubsData.push(subredditData);
            }
        });

        TBCore.mySubs = TBHelpers.saneSort(TBCore.mySubs);
        TBCore.mySubsData = TBHelpers.sortBy(TBCore.mySubsData, 'subscribers');
        // Update the cache.
        TBStorage.setCache(SETTINGS_NAME, 'moderatedSubs', TBCore.mySubs);
        TBStorage.setCache(SETTINGS_NAME, 'moderatedSubsData', TBCore.mySubsData);
    }

    if (newModSubs && newModSubs.length > 0) {
        processNewModSubs();
    } else {
        TBCore.mySubs = cacheDetails.moderatedSubs;
        TBCore.mySubsData = cacheDetails.moderatedSubsData;
    }

    // Get cached info. Short stored.
    TBCore.noteCache = cacheDetails.noteCache;
    TBCore.noConfig = cacheDetails.noConfig;
    TBCore.noNotes = cacheDetails.noNotes;

    // Get cached info. Long stored.
    TBCore.configCache = cacheDetails.configCache;
    TBCore.rulesCache = cacheDetails.rulesCache;
    TBCore.noRules = cacheDetails.noRules;

    /**
     * Updates in page cache and background page.
     * @function
     * @param {string} cacheNAme the cache to be written.
     * @param {} value the cache value to be updated
     * @param {string} subreddit when present cache is threated as an object and the
     * value will be written to subreddit property. If missing the value is pushed.
     */
    TBCore.updateCache = function updateCache (cacheName, value, subreddit) {
        logger.debug('update cache', cacheName, subreddit, value);

        if (subreddit) {
            TBCore[cacheName][subreddit] = value;
        } else {
            TBCore[cacheName].push(value);
        }

        TBStorage.setCache('Utils', cacheName, TBCore[cacheName]);
    };

    // Update cache vars as needed.
    if (newLogin) {
        logger.log('Account changed');
        TBStorage.setCache(SETTINGS_NAME, 'cacheName', TBCore.logged);

        // Force refresh of timed cache
        browser.runtime.sendMessage({
            action: 'tb-cache-force-timeout',
        });
    }

    // Clean up old seen items if the lists are getting too long

    TBStorage.getSettingAsync('Notifier', 'unreadPushed', []).then(async pushedunread => {
        if (pushedunread.length > 250) {
            pushedunread.splice(150, pushedunread.length - 150);
            await TBStorage.setSettingAsync('Notifier', 'unreadPushed', pushedunread);
        }
    });
    TBStorage.getSettingAsync('Notifier', 'modqueuePushed', []).then(async pusheditems => {
        if (pusheditems.length > 250) {
            pusheditems.splice(150, pusheditems.length - 150);
            await TBStorage.setSettingAsync('Notifier', 'modqueuePushed', pusheditems);
        }
    });
    // Clean up the list of seen notes if it's too large
    await TBStorage.getSettingAsync(SETTINGS_NAME, 'seenNotes', []).then(async seenNotes => {
        if (seenNotes.length > 250) {
            logger.log('clearing seen notes');
            seenNotes.splice(150, seenNotes.length - 150);
            await TBStorage.setSettingAsync(SETTINGS_NAME, 'seenNotes', seenNotes);
        }
    });

    if (!toolboxDevs || toolboxDevs.length < 1) {
        // TODO: getToolboxDevs relies on TBApi.getJSON, which is only set
        //       after this code gets called. So, we use setTimeout to queue
        //       the call and execute it after the methods we need are all
        //       defined.
        setTimeout(getToolboxDevs, 0);
    }

    // Extra checks on old faults
    if (typeof lastVersion !== 'number') {
        lastVersion = parseInt(lastVersion);
        TBStorage.setSetting(SETTINGS_NAME, 'lastVersion', lastVersion);
    }

    let shortLength = TBStorage.getSetting(SETTINGS_NAME, 'shortLength', 15),
        longLength = TBStorage.getSetting(SETTINGS_NAME, 'longLength', 45);

    if (typeof shortLength !== 'number') {
        shortLength = parseInt(shortLength);
        TBStorage.setSetting(SETTINGS_NAME, 'shortLength', shortLength);
    }

    if (typeof longLength !== 'number') {
        longLength = parseInt(longLength);
        TBStorage.setSetting(SETTINGS_NAME, 'longLength', longLength);
    }

    // First run changes.

    if (shortVersion > lastVersion) {
        // These need to happen for every version change
        TBCore.firstRun = true; // for use by other modules.
        TBStorage.setSetting(SETTINGS_NAME, 'lastVersion', shortVersion); // set last version to this version.
        setTimeout(getToolboxDevs, 0); // always repopulate tb devs for each version change

        //* * This should be a per-release section of stuff we want to change in each update.  Like setting/converting data/etc.  It should always be removed before the next release. **//

        // Start: version changes.
        // reportsThreshold should be 0 by default
        if (lastVersion < 50101) {
            TBStorage.setSetting('QueueTools', 'reportsThreshold', 0);
        }

        // End: version changes.

        // This is a super extra check to make sure the wiki page for settings export really is private.
        const settingSubEnabled = TBStorage.getSetting('Utils', 'settingSub', '');
        if (settingSubEnabled) {
            // Depends on TBCore functionality that has not been defined yet.
            // The timeout queues execution.
            setTimeout(() => {
                setWikiPrivate('tbsettings', settingSubEnabled, false);
            }, 0);
        }

        // These two should be left for every new release. If there is a new beta feature people want, it should be opt-in, not left to old settings.
        // TBStorage.setSetting('Notifier', 'lastSeenModmail', now); // don't spam 100 new mod mails on first install.
        // TBStorage.setSetting('Notifier', 'modmailCount', 0);
        TBStorage.setSetting(SETTINGS_NAME, 'debugMode', false);
        TBStorage.setSetting(SETTINGS_NAME, 'betaMode', false);
        TBCore.betaMode = false;
    }

    TBCore.config = {
        ver: TBCore.configSchema,
        domainTags: '',
        removalReasons: '',
        modMacros: '',
        usernoteColors: '',
        banMacros: '',
    };

    TBCore.events = {
        TB_ABOUT_PAGE: 'TB_ABOUT_PAGE',
        TB_APPROVE_THING: 'TB_APPROVE_THING',
        TB_FLY_SNOO: 'TB_FLY_SNOO',
        TB_KILL_SNOO: 'TB_KILL_SNOO',
        TB_SAMPLE_SOUND: 'TB_SAMPLE_SOUND',
        TB_SYNTAX_SETTINGS: 'TB_SYNTAX_SETTINGS',
        TB_UPDATE_COUNTERS: 'TB_UPDATE_COUNTERS',
    };

    TBCore.defaultUsernoteTypes = [
        {key: 'gooduser', color: 'green', text: 'Good Contributor'},
        {key: 'spamwatch', color: 'fuchsia', text: 'Spam Watch'},
        {key: 'spamwarn', color: 'purple', text: 'Spam Warning'},
        {key: 'abusewarn', color: 'orange', text: 'Abuse Warning'},
        {key: 'ban', color: 'red', text: 'Ban'},
        {key: 'permban', color: 'darkred', text: 'Permanent Ban'},
        {key: 'botban', color: 'black', text: 'Bot Ban'},
    ];

    // Methods and stuff

    /**
     * @typedef {Object} debugObject
     * @memberof TBCore
     * @property {string} toolboxVersion The toolbox version
     * @property {string} browser Browser used (Firefox, Chrome, etc)
     * @property {string} browserVersion The version of the browser
     * @property {string} platformInformation Other platform information
     * @property {boolean} betaMode toolbox beta mode enabled
     * @property {boolean} debugMode  toolbox debugMode enabled
     * @property {boolean} compactMode toolbox compactmode enabled
     * @property {boolean} advancedSettings toolbox advanced settings enabled
     * @property {boolean} cookiesEnabled Browser cookies enabled
     */

    /**
     * Takes an absolute path for a link and prepends the www.reddit.com
     * domain if we're in new modmail (mod.reddit.com). Makes absolute path
     * links work everywhere.
     * @function
     * @param {string} link The link path, starting with "/"
     * @returns {string}
     */
    TBCore.link = link => isNewModmail ? `https://www.reddit.com${link}` : link;

    /**
     * Puts important debug information in a object so we can easily include
     * it in /r/toolbox posts and comments when people need support.
     * @function
     * @returns {TBCore.debugObject} Object with debug information
     */
    TBCore.debugInformation = function debugInformation () {
        const debugObject = {
            toolboxVersion,
            browser: '',
            browserVersion: '',
            platformInformation: '',
            betaMode: TBCore.betaMode,
            debugMode: TBStorage.getSetting(SETTINGS_NAME, 'debugMode', false),
            compactMode: TBStorage.getSetting('Modbar', 'compactHide', false),
            advancedSettings: TBCore.advancedMode,
            cookiesEnabled: navigator.cookieEnabled,
        };

        const browserUserAgent = navigator.userAgent;
        let browserMatchedInfo = [];
        switch (browserName) {
        case CHROME: {
            // Let's first make sure we are actually dealing with chrome and not some other chrome fork that also supports extension.
            // This way we can also cut some support requests short.
            const vivaldiRegex = /\((.*?)\).*Vivaldi\/([0-9.]*?)$/;
            const yandexRegex = /\((.*?)\).*YaBrowser\/([0-9.]*).*$/;
            const chromeRegex = /\((.*?)\).*Chrome\/([0-9.]*).*$/;
            if (navigator.userAgent.indexOf(' Vivaldi/') >= 0 && vivaldiRegex.test(browserUserAgent)) { // Vivaldi
                browserMatchedInfo = browserUserAgent.match(vivaldiRegex);
                debugObject.browser = 'Vivaldi';
                debugObject.browserVersion = browserMatchedInfo[2];
                debugObject.platformInformation = browserMatchedInfo[1];
            } else if (navigator.userAgent.indexOf(' YaBrowser/') >= 0 && yandexRegex.test(browserUserAgent)) { // Yandex
                browserMatchedInfo = browserUserAgent.match(yandexRegex);
                debugObject.browser = 'Yandex';
                debugObject.browserVersion = browserMatchedInfo[2];
                debugObject.platformInformation = browserMatchedInfo[1];
            } else if (chromeRegex.test(browserUserAgent)) {
                browserMatchedInfo = browserUserAgent.match(chromeRegex);
                debugObject.browser = 'Chrome';
                debugObject.browserVersion = browserMatchedInfo[2];
                debugObject.platformInformation = browserMatchedInfo[1];
            } else {
                debugObject.browser = 'Chrome derivative';
                debugObject.browserVersion = 'Unknown';
                debugObject.platformInformation = browserUserAgent;
            }
            break;
        }
        case FIREFOX: {
            const firefoxRegex = /\((.*?)\).*Firefox\/([0-9.]*?)$/;
            const firefoxDerivativeRegex = /\((.*?)\).*(Firefox\/[0-9.].*?)$/;
            if (firefoxRegex.test(browserUserAgent)) {
                browserMatchedInfo = browserUserAgent.match(firefoxRegex);
                debugObject.browser = 'Firefox';
                debugObject.browserVersion = browserMatchedInfo[2];
                debugObject.platformInformation = browserMatchedInfo[1];
            } else if (firefoxDerivativeRegex.test(browserUserAgent)) {
                browserMatchedInfo = browserUserAgent.match(firefoxDerivativeRegex);
                debugObject.browser = 'Firefox derivative';
                debugObject.browserVersion = browserMatchedInfo[2];
                debugObject.platformInformation = browserMatchedInfo[1];
            } else {
                debugObject.browser = 'Firefox derivative';
                debugObject.browserVersion = 'Unknown';
                debugObject.platformInformation = browserUserAgent;
            }
            break;
        }
        case OPERA: {
            browserMatchedInfo = browserUserAgent.match(/\((.*?)\).*OPR\/([0-9.]*?)$/);
            debugObject.browser = 'Opera';
            debugObject.browserVersion = browserMatchedInfo[2];
            debugObject.platformInformation = browserMatchedInfo[1];
            break;
        }
        case EDGE: {
            browserMatchedInfo = browserUserAgent.match(/\((.*?)\).*Edg\/([0-9.]*).*$/);
            debugObject.browser = 'Edge';
            debugObject.browserVersion = browserMatchedInfo[2];
            debugObject.platformInformation = browserMatchedInfo[1];
            break;
        }
        case UNKNOWN_BROWSER: {
            debugObject.browser = 'Unknown';
            debugObject.browserVersion = 'Unknown';
            debugObject.platformInformation = browserUserAgent;
            break;
        }
        default: {
            // This should really never happen, but just in case I left it in.
            debugObject.browser = 'Error in browser detection';
            debugObject.browserVersion = 'Unknown';
            debugObject.platformInformation = browserUserAgent;
        }
        }
        // info level is always displayed unless disabled in devmode
        logger.info('Version/browser information:', debugObject);
        return debugObject;
    };

    /**
     * Fetches the toolbox dev from /r/toolbox or falls back to a predefined list.
     * @function
     * @returns {array} List of toolbox devs
     */
    TBCore.getToolboxDevs = function getToolboxDevs () {
        getToolboxDevs();
    };

    TBCore.sendEvent = function (tbuEvent) {
        logger.log('Sending event:', tbuEvent);
        window.dispatchEvent(new CustomEvent(tbuEvent));
    };

    TBCore.catchEvent = function (tbuEvent, callback) {
        if (!callback) {
            return;
        }

        window.addEventListener(tbuEvent, callback);
    };

    TBCore.modSubCheck = function (callback) {
        getModSubs().then(() => {
            const subCount = TBCore.mySubsData.length;
            let subscriberCount = 0;
            TBCore.mySubsData.forEach(subreddit => {
                subscriberCount += subreddit.subscribers;
            });
            subscriberCount -= subCount;
            if (subscriberCount > 25) {
                return callback(true);
            } else {
                return callback(false);
            }
        });
    };

    TBCore.getThingInfo = function (sender, modCheck) {
        // First we check if we are in new modmail thread and for now we take a very simple.
        // Everything we need info for is centered around threads.
        const permaCommentLinkRegex = /(\/r\/[^/]*?\/comments\/[^/]*?\/)([^/]*?)(\/[^/]*?\/?)$/;
        const permaLinkInfoRegex = /\/r\/([^/]*?)\/comments\/([^/]*?)\/([^/]*?)\/([^/]*?)\/?$/;

        // declare what we will need.
        const $sender = $(sender);
        const $body = $('body');

        let subreddit,
            permalink,
            permalink_newmodmail,
            domain,
            id,
            postID,
            body,
            title,
            kind,
            postlink,
            banned_by,
            spam,
            ham,
            user,
            approved_by,
            $textBody,
            subredditType;

        // If new modmail the method is slightly different.
        if (isNewModmail) {
            subredditType = '';
            // Lack of a better name, can be a thread_message or infobar.
            const $threadBase = $($sender.closest('.Thread__message')[0] || $sender.find('.InfoBar')[0] || $sender);
            const browserUrl = window.location.href;

            const idRegex = new RegExp('.*mod.reddit.com/mail/.*?/(.*?)$', 'i');

            subreddit = $body.find('.ThreadTitle__community').text();
            const idMatch = browserUrl.match(idRegex);
            // `idMatch` can be null when quickly navigating away (in which case `id` is inconsequential)
            id = idMatch ? idMatch[1] : 'racey';

            permalink_newmodmail = $threadBase.find('.m-link').length ? `https://mod.reddit.com${$threadBase.find('.m-link').attr('href')}` : `https://mod.reddit.com/mail/perma/${id}`;

            permalink = $body.find('.ThreadTitle__messageLink');
            permalink = permalink.length ? permalink[0].href : permalink_newmodmail;

            // Funny story, there is currently no functionality in new modmail that can make use of the body.
            // Macros look at the sidebar and other modules don't need the body.
            // Todo: Figure out what body to present when activated from modmacro.
            $textBody = $threadBase.find('.Message__body .md').clone();

            $textBody.find('.RESUserTag, .voteWeight, .keyNavAnnotation').remove();
            body = $textBody.text() || '';
            body = body.replace(/^\s+|\s+$/g, '');
            $textBody.remove();
            title = $body.find('.ThreadTitle__title').text();
            kind = $threadBase.hasClass('.Thread__message') ? 'modmailmessage' : 'modmailthread';
            spam = false;
            ham = false;
            user = $threadBase.find('.Message__author').first().text() || $body.find('.InfoBar__username').first().text();
        } else {
            const $entry = $($sender.closest('.entry')[0] || $sender.find('.entry')[0] || $sender);
            const $thing = $($sender.closest('.thing')[0] || $sender);

            subredditType = $thing.attr('data-subreddit-type');
            user = $entry.find('.author:first').text() || ($entry.has('> .tagline') ? '[deleted]' : $thing.find('.author:first').text());
            subreddit = $thing.attr('data-subreddit') || post_site || $entry.find('.subreddit:first').text() || $thing.find('.subreddit:first').text() || $entry.find('.tagline .head b > a[href^="/r/"]:not(.moderator)').text();
            permalink = $entry.find('a.bylink').attr('href') || $entry.find('.buttons:first .first a').attr('href') || $thing.find('a.bylink').attr('href') || $thing.find('.buttons:first .first a').attr('href');
            domain = ($entry.find('span.domain:first').text() || $thing.find('span.domain:first').text()).replace('(', '').replace(')', '');
            id = $entry.attr('data-fullname') || $thing.attr('data-fullname') || $sender.closest('.usertext').find('input[name=thing_id]').val();
            $textBody = $entry.find('.usertext-body:first').clone() || $thing.find('.usertext-body:first').clone();
            $textBody.find('.RESUserTag, .voteWeight, .keyNavAnnotation').remove();
            body = $textBody.text() || '';
            body = body.replace(/^\s+|\s+$/g, '');

            $textBody.remove();

            // These need some fall backs, but only removal reasons use them for now.
            title = $thing.find('a.title').length ? $thing.find('a.title').text() : '';
            kind = $thing.hasClass('link') ? 'submission' : 'comment';
            postlink = $thing.find('a.title').attr('href');

            // removed? spam or ham?
            const removal = ($entry.find('.flat-list.buttons li b:contains("removed by")').text() || '').match(/removed by (.+) \(((?:remove not |confirm )?spam)/) || [];

            banned_by = removal[1] || '';
            spam = removal[2] === 'spam' || removal[2] === 'confirm spam';
            ham = removal[2] === 'remove not spam';

            if (isEditUserPage && !user) {
                user = $sender.closest('.user').find('a:first').text() || $entry.closest('.user').find('a:first').text() || $thing.closest('.user').find('a:first').text();
            }

            // If we still don't have a sub, we're in mod mail, or PMs.
            if (isModmail || $sender.closest('.message-parent')[0] !== undefined) {
                // Change it to use the parent's title.
                title = $sender.find('.subject-text:first').text();
                subreddit = subreddit ? subreddit : $entry.find('.head a:last').text() || $thing.find('.head a:last').text();
                // This is a weird palce to go about this, and the conditions are strange,
                // but if we're going to assume we're us, we better make damned well sure that is likely the case.
                // if ($entry.find('.remove-button').text() === '') {
                // The previous check would mistakenly catch removed modmail messages as the user's messages.
                // This check should be safe, since the only time we get no username in modmail is the user's own message. -dakta
                // The '.message-parent' check fixes reddit.com/message/messages/, which contains mod mail and PMs.

                // There are two users in the tagline, the first one is the user sending the message so we want to target that user.
                user = $entry.find('.sender a.author').text();
                // If there is only one use present and it says "to" it means that this is not the user sending the message.
                if ($entry.find('.sender a.author').length < 1 && $entry.find('.recipient a.author').length > 0) {
                    user = TBCore.logged;
                }
                if (user === '') {
                    user = TBCore.logged;
                    if (!subreddit || subreddit.indexOf('/r/') < 1) {
                        // Find a better way, I double dog dare ya!
                        subreddit = $thing.closest('.message-parent').find('.correspondent.reddit.rounded a').text();
                    }
                }
            }
            const approved_text = $entry.find('.approval-checkmark').attr('title') || $thing.find('.approval-checkmark').attr('title') || '';
            approved_by = approved_text.match(/by\s(.+?)\s/) || '';
        }

        // A recent reddit change makes subreddit names sometimes start with "/r/".
        // Mod mail subreddit names additionally end with "/".
        // reddit pls, need consistency
        subreddit = TBHelpers.cleanSubredditName(subreddit);

        // Not a mod, reset current sub.
        if (modCheck && !modsSub(subreddit)) {
            subreddit = '';
        }

        if (user === '[deleted]') {
            user = '';
        }

        // If the permalink is relative, stick the current domain name in.
        // Only do so if a permalink is found.
        if (permalink && permalink.slice(0, 1) === '/') {
            permalink = baseDomain + permalink;
        }

        if (permalink && permaCommentLinkRegex.test(permalink)) {
            const permalinkDetails = permalink.match(permaLinkInfoRegex);
            postID = `t3_${permalinkDetails[2]}`;
            permalink = permalink.replace(permaCommentLinkRegex, '$1-$3');
        }

        const info = {
            subreddit,
            subredditType,
            user,
            author: user,
            permalink,
            permalink_newmodmail: permalink_newmodmail || permalink,
            url: permalink,
            domain,
            id,
            postID: postID || '',
            body: `> ${body.split('\n').join('\n> ')}`,
            raw_body: body,
            uri_body: encodeURIComponent(body).replace(/\)/g, '\\)'),
            approved_by,
            title,
            uri_title: encodeURIComponent(title).replace(/\)/g, '\\)'),
            kind,
            postlink,
            link: postlink,
            banned_by,
            spam,
            ham,
            rules: subreddit ? TBCore.link(`/r/${subreddit}/about/rules`) : '',
            sidebar: subreddit ? TBCore.link(`/r/${subreddit}/about/sidebar`) : '',
            wiki: subreddit ? TBCore.link(`/r/${subreddit}/wiki/index`) : '',
            mod: TBCore.logged,
        };

        return info;
    };

    function findMessage (object, searchID) {
        let found;
        switch (object.kind) {
        case 'Listing':
            for (let i = 0; i < object.data.children.length; i++) {
                const childFound = findMessage(object.data.children[i], searchID);
                if (childFound) {
                    found = childFound;
                }
            }
            break;
        case 't4':
            logger.log('t4:', object.data.id);
            if (object.data.id === searchID) {
                found = object;
            }

            if (Object.prototype.hasOwnProperty.call(object.data, 'replies') && object.data.replies && typeof object.data.replies === 'object') {
                const childFound = findMessage(object.data.replies, searchID); // we need to go deeper.
                if (childFound) {
                    found = childFound;
                }
            }
            break;
        default:
            break;
        }
        return found;
    }

    TBCore.getApiThingInfo = function (id, subreddit, modCheck, callback) {
        if (id.startsWith('t4_')) {
            const shortID = id.substr(3);
            TBApi.getJSON(`/message/messages/${shortID}.json`).then(response => {
                TBStorage.purifyObject(response);
                const message = findMessage(response, shortID);
                const body = message.data.body,
                      user = message.data.author,
                      title = message.data.subject,
                      permalink = `/message/messages/${shortID}`;

                let subreddit = message.data.subreddit || '';

                if (modCheck && !modsSub(subreddit)) {
                    subreddit = '';
                }

                const info = {
                    subreddit,
                    user,
                    author: user,
                    permalink,
                    url: permalink,
                    domain: '',
                    id,
                    body: `> ${body.split('\n').join('\n> ')}`,
                    raw_body: body,
                    uri_body: encodeURIComponent(body).replace(/\)/g, '\\)'),
                    approved_by: '',
                    title,
                    uri_title: encodeURIComponent(title).replace(/\)/g, '\\)'),
                    kind: 'comment',
                    postlink: '',
                    link: '',
                    banned_by: '',
                    spam: '',
                    ham: '',
                    rules: subreddit ? TBCore.link(`/r/${subreddit}/about/rules`) : '',
                    sidebar: subreddit ? TBCore.link(`/r/${subreddit}/about/sidebar`) : '',
                    wiki: subreddit ? TBCore.link(`/r/${subreddit}/wiki/index`) : '',
                    mod: TBCore.logged,
                };

                callback(info);
            });
        } else {
            const permaCommentLinkRegex = /(\/r\/[^/]*?\/comments\/[^/]*?\/)([^/]*?)(\/[^/]*?\/?)$/;
            TBApi.getJSON(`/r/${subreddit}/api/info.json`, {id}).then(response => {
                TBStorage.purifyObject(response);
                const data = response.data;

                let user = data.children[0].data.author;
                const body = data.children[0].data.body || data.children[0].data.selftext || '';
                let permalink = data.children[0].data.permalink;
                const title = data.children[0].data.title || '';
                const postlink = data.children[0].data.url || '';
                // A recent reddit change makes subreddit names sometimes start with "/r/".
                // Mod mail subreddit names additionally end with "/".
                // reddit pls, need consistency
                subreddit = TBHelpers.cleanSubredditName(subreddit);

                // Not a mod, reset current sub.
                if (modCheck && !modsSub(subreddit)) {
                    subreddit = '';
                }

                if (user === '[deleted]') {
                    user = '';
                }

                // If the permalink is relative, stick the current domain name in.
                // Only do so if a permalink is found.
                if (permalink && permalink.slice(0, 1) === '/') {
                    permalink = baseDomain + permalink;
                }

                if (permalink && permaCommentLinkRegex.test(permalink)) {
                    permalink = permalink.replace(permaCommentLinkRegex, '$1-$3');
                }

                if (modCheck && !modsSub(subreddit)) {
                    subreddit = '';
                }

                const info = {
                    subreddit,
                    user,
                    author: user,
                    permalink,
                    url: permalink,
                    domain: data.children[0].data.domain || '',
                    id,
                    body: `> ${body.split('\n').join('\n> ')}`,
                    raw_body: body,
                    uri_body: encodeURIComponent(body).replace(/\)/g, '\\)'),
                    approved_by: data.children[0].data.approved_by,
                    title,
                    uri_title: encodeURIComponent(title).replace(/\)/g, '\\)'),
                    kind: data.children[0].kind === 't3' ? 'submission' : 'comment',
                    postlink,
                    link: postlink,
                    banned_by: data.children[0].data.banned_by,
                    spam: data.children[0].data.spam,
                    ham: data.children[0].data.removed,
                    rules: subreddit ? TBCore.link(`/r/${subreddit}/about/rules`) : '',
                    sidebar: subreddit ? TBCore.link(`/r/${subreddit}/about/sidebar`) : '',
                    wiki: subreddit ? TBCore.link(`/r/${subreddit}/wiki/index`) : '',
                    mod: TBCore.logged,
                };
                callback(info);
            });
        }
    };

    TBCore.reloadToolbox = function () {
        TBui.textFeedback('toolbox is reloading', TBui.FEEDBACK_POSITIVE, 10000, TBui.DISPLAY_BOTTOM);
        browser.runtime.sendMessage({action: 'tb-reload'}).then(() => {
            window.location.reload();
        });
    };

    // Import export methods
    TBCore.exportSettings = function (subreddit, callback) {
        const settingsObject = {};
        $(TBStorage.settings).each(function () {
            if (this === 'Storage.settings') {
                return;
            } // don't backup the setting registry.

            const key = this.split('.'),
                  setting = TBStorage.getSetting(key[0], key[1], null);

            if (setting !== null && setting !== undefined) { // DO NOT, EVER save null (or undefined, but we shouldn't ever get that)
                settingsObject[this] = setting;
            }
        });

        TBApi.postToWiki('tbsettings', subreddit, settingsObject, 'exportSettings', true, false).then(callback);
    };

    TBCore.importSettings = function (subreddit, callback) {
        TBApi.readFromWiki(subreddit, 'tbsettings', true).then(resp => {
            if (!resp || resp === WIKI_PAGE_UNKNOWN || resp === NO_WIKI_PAGE) {
                logger.log('Error loading wiki page');
                return;
            }
            TBStorage.purifyObject(resp);
            if (resp['Utils.lastversion'] < 300) {
                TBui.textFeedback('Cannot import from a toolbox version under 3.0');
                logger.log('Cannot import from a toolbox version under 3.0');
                return;
            }

            const doNotImport = [
                'oldreddit.enabled',
            ];

            Object.entries(resp).forEach(([fullKey, value]) => {
                const key = fullKey.split('.');

                // Do not import certain legacy settings.
                if (doNotImport.includes(fullKey)) {
                    logger.log(`Skipping ${fullKey} import`);
                } else {
                    TBStorage.setSetting(key[0], key[1], value, false);
                }
            });

            callback();
        });
    };

    TBCore.addToSiteTable = function (URL, callback) {
        if (!callback) {
            return;
        }

        if (!URL) {
            return callback(null);
        }

        TBApi.getJSON(URL).then(resp => {
            if (!resp) {
                return callback(null);
            }
            resp = resp.replace(/<script(.|\s)*?\/script>/g, '');
            const $sitetable = $(resp).find('#siteTable');
            $sitetable.find('.nextprev').remove();

            if ($sitetable.length) {
                callback($sitetable);
            } else {
                callback(null);
            }
        });
    };

    // Cache manipulation

    TBCore.clearCache = function (calledFromBackground) {
        logger.log('TBCore.clearCache()');

        TBCore.noteCache = {};
        TBCore.configCache = {};
        TBCore.rulesCache = {};
        TBCore.noConfig = [];
        TBCore.noNotes = [];
        TBCore.noRules = [];
        TBCore.mySubs = [];
        TBCore.mySubsData = [];

        TBStorage.clearCache();

        if (!calledFromBackground) {
            browser.runtime.sendMessage({
                action: 'tb-global',
                globalEvent: 'clearCache',
            });
        }
    };

    TBCore.hasNoConfig = function (sub) {
        return TBCore.noConfig.indexOf(sub) !== -1;
    };

    TBCore.hasConfig = function (sub) {
        return TBCore.configCache[sub] !== undefined;
    };

    TBCore.getConfig = function (sub, callback) {
        if (TBCore.hasNoConfig(sub)) {
            callback(false, sub);
        } else if (TBCore.hasConfig(sub)) {
            callback(TBCore.configCache[sub], sub);
        } else {
            TBApi.readFromWiki(sub, 'toolbox', true).then(resp => {
                if (!resp || resp === WIKI_PAGE_UNKNOWN) {
                    // Complete and utter failure
                    callback(false, sub);
                } else if (resp === NO_WIKI_PAGE) {
                    // Subreddit not configured yet
                    TBCore.updateCache('noConfig', sub, false);
                    callback(false, sub);
                } else {
                    // It works!
                    TBStorage.purifyObject(resp);
                    TBCore.updateCache('configCache', resp, sub);
                    callback(resp, sub);
                }
            });
        }
    };

    let firstCacheTimeout = true;
    // Listen to background page communication and act based on that.
    browser.runtime.onMessage.addListener(message => {
        switch (message.action) {
        case 'clearCache': {
            TBCore.clearCache(true);
            break;
        }
        case 'tb-cache-timeout': {
            logger.log('Timed cache update', message.payload);
            // Cache has timed out
            if (message.payload === 'short') {
                TBCore.noteCache = {};
                TBCore.noConfig = [];
                TBCore.noNotes = [];
            }

            if (message.payload === 'long') {
                TBCore.configCache = {};
                TBCore.rulesCache = {};
                TBCore.noRules = [];
                TBCore.mySubs = [];
                TBCore.mySubsData = [];

                // On first init where the modsubs cache was empty we already got this data.
                // Here we simply use that data to fill the cache so we don't need to do unneeded actions.
                if (newModSubs && newModSubs.length > 0 && firstCacheTimeout) {
                    firstCacheTimeout = false;
                    processNewModSubs();
                }
            }

            break;
        }
        default: {
            const event = new CustomEvent(message.action, {detail: message.payload});
            window.dispatchEvent(event);
        }
        }
    });

    // private functions
    function setWikiPrivate (subreddit, page, failAlert) {
        TBApi.sendRequest({
            okOnly: true,
            method: 'POST',
            endpoint: `/r/${subreddit}/wiki/settings/`,
            body: {
                page,
                listed: true, // hrm, may need to make this a config setting.
                permlevel: 2,
                uh: TBCore.modhash,
            },
        })
            // Super extra double-secret secure, just to be safe.
            .then(() => {
                // used if it is important for the user to know that a wiki page has not been set to private.
                if (failAlert) {
                    alert('error setting wiki page to mod only access');
                    window.location = `https://www.reddit.com/r/${subreddit}/wiki/settings/${page}`;
                } else {
                    logger.log('error setting wiki page to mod only access');
                }
            });
    }

    function getToolboxDevs () {
        TBApi.getJSON('/r/toolbox/about/moderators.json').then(resp => {
            TBStorage.purifyObject(resp);
            const children = resp.data.children,
                  devs = [];

            children.forEach(child => {
                // AutoModerator seems to add itself to /r/toolbox sometimes, but it's definitely not a developer
                if (child.name === 'AutoModerator') {
                    return;
                }
                devs.push(child.name);
            });
            TBCore.tbDevs = devs;
            TBStorage.setSetting(SETTINGS_NAME, 'tbDevs', devs);
        }).catch(() => {
            const devs = [
                'agentlame',
                'creesch',
                'LowSociety ',
                'TheEnigmaBlade',
                'dakta',
                'largenocream',
                'psdtwk',
                'amici_ursi',
                'noeatnosleep',
                'Garethp',
                'WorseThanHipster',
                'eritbh',
            ];
            TBCore.tbDevs = devs;
            TBStorage.setSetting(SETTINGS_NAME, 'tbDevs', devs);
        });
    }

    // Watch for locationHref changes and sent an event with details
    let locationHref;
    let locationHash;

    // new modmail regex matches.
    const newMMlistingReg = /^\/mail\/(all|inbox|new|inprogress|archived|highlighted|mod|notifications|perma|appeals)\/?$/;
    const newMMconversationReg = /^\/mail\/(all|inbox|new|inprogress|archived|highlighted|mod|notifications|perma|appeals|thread)\/?([^/]*)\/?(?:[^/]*\/?)?$/;
    const newMMcreate = /^\/mail\/create\/?$/;

    // reddit regex matches.
    const redditFrontpageReg = /^\/?(hot|new|rising|controversial)?\/?$/;
    const subredditFrontpageReg = /^\/r\/([^/]*?)\/?(hot|new|rising|controversial)?\/?$/;
    const subredditCommentListingReg = /^\/r\/([^/]*?)\/comments\/?$/;
    const subredditCommentsPageReg = /^\/r\/([^/]*?)\/comments\/([^/]*?)\/([^/]*?)\/?$/;
    const subredditPermalinkCommentsPageReg = /^\/r\/([^/]*?)\/comments\/([^/]*?)\/([^/]*?)\/([^/]*?)\/?$/;
    const subredditWikiPageReg = /^\/r\/([^/]*?)\/wiki\/?(edit|revisions|settings|discussions)?\/(.+)\/?$/;
    const queuePageReg = /^\/r\/([^/]*?)\/about\/(modqueue|reports|edited|unmoderated|spam)\/?$/;
    const userProfile = /^\/user\/([^/]*?)\/?(overview|submitted|posts|comments|saved|upvoted|downvoted|hidden|gilded)?\/?$/;
    const userModMessage = /^\/message\/([^/]*?)\/([^/]*?)?\/?$/;

    // Once a change in the page hash is detected in toolbox format it will abstract the parms and send out an event.
    function refreshHashContext () {
        if (window.location.hash && window.location.hash !== locationHash) {
            const locationHash = window.location.hash;
            const hash = locationHash.substring(1);
            // To make sure we only trigger on toolbox hashes we check that the first param starts with `tb`.
            // This because `tbsettings` is already used for settings.
            if (hash.startsWith('?tb')) {
                const paramObject = {};
                const params = hash.split('&');
                params.forEach(param => {
                    const keyval = param.split('=');
                    const key = keyval[0].replace('?', ''),
                          val = keyval[1];
                    paramObject[key] = val;
                });
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('TBHashParams', {detail: paramObject}));
                }, 500);
            }
        } else if (!window.location.hash) {
            locationHash = null;
        }
    }

    // Once a change is detected it will abstract all the context information from url, update TBCore variables and emit all information in an event.
    // NOTE: this function is a work in progress, page types are added once needed. Currently supported pages where context are provided are:
    // NewModmail: listings, conversations, create
    // reddit frontpage: sorting
    // subreddits: listing including sorting, submissions, submissions with permalink
    function refreshPathContext () {
        const samePage = locationHref === location.href;
        if (!samePage) {
            const oldHref = locationHref;
            locationHref = location.href;

            const contextObject = {
                oldHref,
                locationHref,
                pageType: '',
                pageDetails: {},
            };

            // new modmail
            if (location.host === 'mod.reddit.com') {
                if (newMMlistingReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(newMMlistingReg);
                    contextObject.pageType = 'modmailListing';
                    contextObject.pageDetails = {
                        listingType: matchDetails[1],
                    };
                } else if (newMMconversationReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(newMMconversationReg);
                    contextObject.pageType = 'modmailConversation';
                    contextObject.pageDetails = {
                        conversationType: matchDetails[1],
                        conversationID: matchDetails[2],
                    };
                } else if (newMMcreate.test(location.pathname)) {
                    contextObject.pageType = 'createModmail';
                } else {
                    contextObject.pageType = 'unknown';
                }
                // other parts of reddit.
            } else {
                if (redditFrontpageReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(redditFrontpageReg);
                    contextObject.pageType = 'frontpage';
                    contextObject.pageDetails = {
                        sortType: matchDetails[1] || 'hot',
                    };
                } else if (subredditFrontpageReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(subredditFrontpageReg);
                    contextObject.pageType = 'subredditFrontpage';
                    contextObject.pageDetails = {
                        subreddit: matchDetails[1],
                        sortType: matchDetails[2] || 'hot',
                    };
                } else if (subredditCommentListingReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(subredditCommentListingReg);
                    contextObject.pageType = 'subredditCommentListing';
                    contextObject.pageDetails = {
                        subreddit: matchDetails[1],
                    };
                } else if (subredditCommentsPageReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(subredditCommentsPageReg);
                    contextObject.pageType = 'subredditCommentsPage';
                    contextObject.pageDetails = {
                        subreddit: matchDetails[1],
                        submissionID: matchDetails[2],
                        linkSafeTitle: matchDetails[3],
                    };
                } else if (subredditPermalinkCommentsPageReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(subredditPermalinkCommentsPageReg);
                    contextObject.pageType = 'subredditCommentPermalink';
                    contextObject.pageDetails = {
                        subreddit: matchDetails[1],
                        submissionID: matchDetails[2],
                        linkSafeTitle: matchDetails[3],
                        commentID: matchDetails[4],
                    };
                } else if (subredditWikiPageReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(subredditWikiPageReg);
                    contextObject.pageType = 'subredditWiki';
                    contextObject.pageDetails = {
                        subreddit: matchDetails[1],
                        action: matchDetails[2],
                        page: matchDetails[3],
                    };
                } else if (queuePageReg.test(location.pathname)) {
                    const matchDetails = location.pathname.match(queuePageReg);
                    contextObject.pageType = 'queueListing';
                    contextObject.pageDetails = {
                        subreddit: matchDetails[1],
                        queueType: matchDetails[2],
                    };
                } else if (userProfile.test(location.pathname)) {
                    const matchDetails = location.pathname.match(userProfile);
                    let listing = matchDetails[2];

                    // silly new profile bussines.
                    if (listing === 'posts') {
                        listing = 'submitted';
                    }
                    if (!listing) {
                        listing = 'overview';
                    }
                    contextObject.pageType = 'userProfile';
                    contextObject.pageDetails = {
                        user: matchDetails[1],
                        listing,
                    };
                } else if (userModMessage.test(location.pathname)) {
                    const matchDetails = location.pathname.match(userModMessage);
                    if (matchDetails[1] === 'moderator') {
                        contextObject.pageType = 'oldModmail';
                        contextObject.pageDetails = {
                            page: matchDetails[2] || 'inbox',
                        };
                    } else {
                        contextObject.pageType = 'message';
                        contextObject.pageDetails = {
                            type: matchDetails[1],
                        };
                    }
                    // "Unknown" pageType.
                } else {
                    contextObject.pageType = 'unknown';
                }
            }

            pageDetails = contextObject;

            // The timeout is there because locationHref can change before react is done rendering.
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('TBNewPage', {detail: contextObject}));
            }, 500);
        }
    }

    refreshPathContext();
    refreshHashContext();
    window.addEventListener('tb-url-changed', () => {
        refreshPathContext();
        refreshHashContext();
    });

    // Watch for new things and send out events based on that.
    if ($('#header').length) {
        let newThingRunning = false;
        // NER, load more comments, and mod frame support.
        const target = document.querySelector('div.content');

        // create an observer instance
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                const $target = $(mutation.target), $parentNode = $(mutation.target.parentNode);

                if ($target.hasClass('expando')) {
                    const expandoEvent = new CustomEvent('tbNewExpando');
                    mutation.target.dispatchEvent(expandoEvent);
                }

                if (!($target.hasClass('sitetable') && ($target.hasClass('nestedlisting') || $target.hasClass('listing') || $target.hasClass('linklisting') ||
                    $target.hasClass('modactionlisting'))) && !$parentNode.hasClass('morecomments') && !$target.hasClass('flowwit')) {
                    return;
                }

                logger.log(`TBNewThings firing from: ${$target.attr('class')}`);
                // It is entirely possible that TBNewThings is fired multiple times.
                // That is why we only set a new timeout if there isn't one set already.
                if (!newThingRunning) {
                    newThingRunning = true;
                    // Wait a sec for stuff to load.
                    setTimeout(() => {
                        newThingRunning = false;
                        const event = new CustomEvent('TBNewThings');
                        window.dispatchEvent(event);
                    }, 1000);
                }
            });
        });

        // configuration of the observer:
        // We specifically want all child elements but nothing else.
        const config = {
            attributes: false,
            childList: true,
            characterData: false,
            subtree: true,
        };

        // pass in the target node, as well as the observer options
        observer.observe(target, config);
    }

    // NER support. todo: finish this.
    // window.addEventListener("neverEndingLoad", function () {
    //    logger.log('NER! NER! NER! NER!');
    // });

    window.onbeforeunload = function () {
        // TBUI now handles the long load array.
        if (TBui.longLoadArray.length > 0) {
            return 'toolbox is still busy!';
        }

        // Just in case.
        // TBStorage.unloading();
    };

    // get toolbox news
    (function getNotes () {
        TBApi.readFromWiki('toolbox', 'tbnotes', true).then(resp => {
            if (!resp || resp === WIKI_PAGE_UNKNOWN || resp === NO_WIKI_PAGE || resp.length < 1) {
                return;
            }
            TBStorage.purifyObject(resp);

            $(resp.notes).each(function () {
                showNote(this);
            });
        });

        if (betaRelease) {
            TBApi.readFromWiki('tb_beta', 'tbnotes', true).then(resp => {
                if (!resp || resp === WIKI_PAGE_UNKNOWN || resp === NO_WIKI_PAGE || resp.length < 1) {
                    return;
                }
                TBStorage.purifyObject(resp);
                $(resp.notes).each(function () {
                    showNote(this);
                });
            });
        }

        // check dev sub, if debugMode
        if (TBStorage.getSetting(SETTINGS_NAME, 'debugMode', false)) {
            TBApi.readFromWiki('tb_dev', 'tbnotes', true).then(resp => {
                if (!resp || resp === WIKI_PAGE_UNKNOWN || resp === NO_WIKI_PAGE || resp.length < 1) {
                    TBCore.devMode = false;
                    TBCore.devModeLock = true;
                    return;
                }
                TBStorage.purifyObject(resp);
                $(resp.notes).each(function () {
                    showNote(this);
                });
            });
        }
    })();

    window.dispatchEvent(new CustomEvent('_coreLoaded'));
})(window.TBCore = window.TBCore || {});
