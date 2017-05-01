'use strict';
const request = require('request');
const cheerio = require('cheerio');
const URL = require('url-parse');
const Deque = require('double-ended-queue');
const commandLineArgs = require('command-line-args');

const commandLineOptionDefinitions = [
  { name: 'verbose', alias: 'v', type: Boolean },
  { name: 'port', alias: 'p', type: String, defaultValue: "3000"},
  { name: 'allErrors', alias: 'e', type: Boolean},
];

const options = commandLineArgs(commandLineOptionDefinitions);

const SEED_URL = `http://localhost:${options.port}/`;
const visited = new Set();
const url_queue = new Deque([SEED_URL]);
// This is used to track whether we have unterminated requests
let current_requests = 0;
// Constants that affect performance
const CHECK_QUEUE_INTERVAL = 50;

crawl();

function crawl() {
  while (!url_queue.isEmpty()) {
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
  if (url_queue.isEmpty()) {
    if (current_requests) {
      setTimeout(wait_for_links.bind(null, interval), interval);
    }
    else {
      // Queue is empty and no more requests so we must be done
      return;
    }
  }
  else {
    // Queue is no longer empty so crawl those links
    crawl();
  }
}

function visit_page(url) {
  if (options.verbose) {
    console.log(`visiting ${url}`);
  }
  visited.add(url);
  current_requests++;
  const current_url_object = new URL(url);
  const base_url = current_url_object.protocol + "//" + current_url_object.hostname;
  const current_hostname = current_url_object.hostname;
  request({
    url,
    headers: {
      'User-Agent': "Emil's test-crawler for internship application coding challenge",
    },
  }, (err, res, body) => {
    // request returned so decrement current requests
    current_requests--;
    if (err) {
      console.error(`Error occured when requesting ${url}: ${err}`);
      if (!options.allErrors) {
        console.error("Exiting crawler with exit code 1 due to error found, if you wish to see all errors use the --allErrors (-e) option");
        process.exit(1);
      }
      return;
    }
    if (res.statusCode !== 200) {
      console.error(`non-200 status code '${res.statusCode}' returned from ${url}`);
      if (!options.allErrors) {
        console.error("Exiting crawler with exit code 1 due to error found, if you wish to see all errors use the --allErrors (-e) option");
        process.exit(1);
      }
      return;
    }

    const $ = cheerio.load(body);
    const links = $('a');
    $(links).each((index, link) => {
      const url = new URL($(link).attr('href'));
      if (url.pathname.split("/")[1] === "cdn-cgi") {
        // It's a cloudflare virtual directory so ignore it
        return;
      }
      if (url.protocol && url.hostname !== current_hostname) {
        // Absolute URL for foreign site
        // We are only staying on localhost
      }
      else if (url.pathname) {
        // URL for our site, either it's relative or absolute with current host
        // Use unshift to prioritize current domain first
        url_queue.unshift(base_url+url.pathname);
      }
      // Else it is garbage such as #
    });
  });
}

