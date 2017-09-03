'use strict';
const request = require('request');
const cheerio = require('cheerio');
const URL = require('url-parse');
const Deque = require('denque');
const commandLineArgs = require('command-line-args');

const commandLineOptionDefinitions = [
  { name: 'verbose', alias: 'v', type: Boolean },
  { name: 'port', alias: 'p', type: String, defaultValue: "3000" },
  { name: 'allErrors', alias: 'e', type: Boolean },
  { name: 'checkQueueInterval', alias: 'i', type: Number, defaultValue: 200 },
  { name: 'concurrent', alias: 'c', type: Number, defaultValue: 50 },
  { name: 'specificPaths', alias: 's', type: String, multiple: true, defaultOption: true },
];

const options = commandLineArgs(commandLineOptionDefinitions);

const BASE_URL = `http://localhost:${options.port}`;
const MAX_CURRENT_REQUESTS = options.concurrent;
const visited = new Set();

// Instantiate the queue of URLs and specify the specific urls if specificPaths option is set
let initialQueueItems = [{url: BASE_URL, source: "seed url"}];
if (options.specificPaths) {
  const createUrlWrapper = url => ({ url, source: 'specificPaths option' });
  initialQueueItems = options.specificPaths.map(path => createUrlWrapper(`${BASE_URL}${path}`));
}
const url_queue = new Deque(initialQueueItems);

// This is used to track whether we have unterminated requests
let current_requests = 0;

// Constants that affect performance
const CHECK_QUEUE_INTERVAL = options.checkQueueInterval;

// Use this to list the sources of errors if allErrors flag is set
const errorSources = [];

crawl();

function crawl() {
  while (!url_queue.isEmpty() && current_requests < MAX_CURRENT_REQUESTS) {
    const next_url = url_queue.shift();
    if (visited.has(next_url)) {
      // We've already seen this URL
      continue;
    }
    visit_page(next_url);
  }
  wait_for_links(CHECK_QUEUE_INTERVAL);
}

function wait_for_links(interval) {
  if (options.verbose) {
    console.log(`Current amount of unanswered requests: ${current_requests}`);
  }
  if (url_queue.isEmpty() || current_requests >= MAX_CURRENT_REQUESTS) {
    if (current_requests) {
      setTimeout(wait_for_links.bind(null, interval), interval);
    }
    else {
      // Queue is empty and there are no more requests so we must be done
      done();
    }
  }
  else {
    // Queue is no longer empty or overfull so crawl those links
    crawl();
  }
}

function handle_error(err, url_wrapper) {
  const url = url_wrapper.url;
  console.error(`Error occured when requesting ${url} : ${err}`);
  console.error(`Source was ${url_wrapper.source}`);
  if (!options.allErrors) {
    console.error("Exiting crawler with exit code 1 due to error found, if you wish to see all errors use the --allErrors (-e) option");
    process.exit(1);
  }
  else {
    // If first time this source has encountered an error add it to the sources
    if (!errorSources.some((sourceURL) => {
      return sourceURL === url_wrapper.source;
    })) {
      errorSources.push(Object.assign({}, url_wrapper));
    }
  }
}


function visit_page(url_wrapper) {
  const url = url_wrapper.url;
  if (options.verbose) {
    console.log(`visiting ${url}`);
  }
  visited.add(url);
  current_requests++;
  const current_url_object = new URL(url);
  const base_url = `${current_url_object.protocol}//${current_url_object.host}`;
  const current_hostname = current_url_object.hostname;
  request({
    url: encodeURI(url),
    headers: {
      'User-Agent': "The Gazelle's internal crawler for end-to-end tests",
    },
  }, (err, res, body) => {
    // request returned so decrement current requests
    current_requests--;
    if (err) {
      handle_error(err, url_wrapper);
      return;
    }
    if (res.statusCode !== 200) {
      const statusError = new Error(`non-200 status code '${res.statusCode}' returned from ${url}`);
      handle_error(statusError, url_wrapper);
      return;
    }
    if (options.specificPaths) {
      // If the specificPaths option is set we don't need to continue crawling for new links
      return;
    }

    const $ = cheerio.load(body);
    const links = $('a');
    $(links).each((index, link) => {
      const discoveredUrl = new URL($(link).attr('href'));
      if (discoveredUrl.pathname.split("/")[1] === "cdn-cgi") {
        // It's a cloudflare virtual directory so ignore it
        return;
      }
      if (discoveredUrl.protocol && discoveredUrl.hostname !== current_hostname) {
        // Absolute URL for foreign site
        // We are only staying on localhost
      }
      else if (discoveredUrl.pathname) {
        // URL for our site, either it's relative or absolute with current host
        // Use unshift to prioritize current domain first

        // For debugging we add a source to each URL
        const wrapper = {
          url: base_url + discoveredUrl.pathname,
          source: current_url_object.href,
        };
        if (visited.has(wrapper.url)) {
          // If we've already seen the URL don't put it on the queue
          // This was creating a huge memory leak and also slowed down the crawler a lot
          // before this if statement was added
          return;
        }
        url_queue.unshift(wrapper);
      }
      // Else it is garbage such as #
    });
  });
}

function done() {
  console.log(`Crawl complete, ${visited.size} URLs traversed`);
  if (options.allErrors) {
    if (errorSources.length > 0) {
      errorSources.sort((a, b) => {
        if (a.source < b.source) {
          return -1;
        }
        if (a.source > b.source) {
          return 1;
        }
        if (a.url < b.url) {
          return -1;
        }
        if (a.url > b.url) {
          return 1;
        }
        return 0;
      });
      console.log("Errors were found. The following URLs were sources of errors:");
      // For formatting we keep track of last source url
      let lastSource = null;
      errorSources.forEach((sourceURLWrapper) => {
        if (lastSource !== null && lastSource !== sourceURLWrapper.source) {
          console.log();
        }
        console.log(`error happened at ${sourceURLWrapper.source} when trying to access ${sourceURLWrapper.url}`);
        lastSource = sourceURLWrapper.source;
      });
      // As there were errors we want to exit with exit code 1
      process.exit(1);
    }
    else {
      console.log("The crawl was error-free, congratulations!");
    }
  }
}
