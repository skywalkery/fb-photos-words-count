'use latest';

import express from 'express';
import { fromExpress } from 'webtask-tools';
import bodyParser from 'body-parser';
import graph from 'fbgraph';
import Clarifai from 'clarifai';
import { MongoClient, ObjectId } from 'mongodb';

const Promise = require('bluebird');
Promise.promisifyAll(graph);

const config = {
    client_id: '1429175207143662',
    scope: 'user_photos',
    redirect_uri: 'https://wt-50a4b43389d58ef63e72f1a6ecc08cbb-0.run.webtask.io/fb-photos-words-count/auth',
    clarifai_client_id: 'VXAymn5AZw6K24zhyDG0ni6A-Wm0obP536LOkmd2'
};

let clarifai = null;

const app = express();

app.use(bodyParser.json());

app.get('/', (req, res) => {
  const HTML = renderView({
    title: 'FB Photos Words Cloud',
  });

  res.set('Content-Type', 'text/html');
  res.status(200).send(HTML);
});

app.get('/ids/:id', (req, res) => {
    let _db = null;

    MongoClient.connect(req.webtaskContext.data.mongo_url, {
        promiseLibrary: Promise
    }).then(db => {
        // fetch document by the requested id
        _db = db;
        return db.collection('words').findOne({ _id: ObjectId(req.params.id) });
    }).then(doc => {
        // transform list of words to list of word and count
        let json = doc || {list:[]};
        let counts = json.list.reduce((prev, item) => {
            if (item in prev) prev[item]++;
            else prev[item] = 1;
            return prev;
        }, {});
        json.list = Object.keys(counts).map(key => [key, counts[key]]);
        return json;
    }).then(json => {
        res.set('Content-Type', 'application/json');
        res.status(200).send(json);
    }).catch(err => {
        console.log('something goes wrong', err);
        res.set('Content-Type', 'text/plain');
        res.status(200).send(err.message);
    }).finally(() => {
        if (_db) {
            _db.close();
        }
    });
});

app.get('/processing', (req, res) => {
    initClarifai(req.webtaskContext.data.clarifai_client_secret);

    let _db = null;

    let docIdPromise = MongoClient.connect(req.webtaskContext.data.mongo_url, {
        promiseLibrary: Promise
    }).then(db => {
        _db = db;
        return insertDocument(db);
    }).then(doc => doc.insertedId);

    docIdPromise.then(id => {
        const HTML = renderProcessingView({
          title: 'Processing...',
          content: 'Processing... ' + id,
          id: id
        });
        res.set('Content-Type', 'text/html');
        res.status(200).send(HTML);
    }).catch(err => {
        console.log('something goes wrong', err);
        res.set('Content-Type', 'text/plain');
        res.status(200).send(err.message);
    });

    docIdPromise.then(id => {
        return getPhotosRequest(_db, id);
    }).catch(err => {
        console.log('something goes wrong while photos process', err);
    }).finally(() => {
        if (_db) {
            _db.close();
        }
    });
});

app.get('/auth', (req, res) => {
    // we don't have a code yet
    // so we'll redirect to the oauth dialog
    if (!req.query.code) {
        console.log("Performing oauth for some user right now.");

        let authUrl = graph.getOauthUrl({
            client_id: config.client_id,
            redirect_uri: config.redirect_uri,
            scope: config.scope
        });

        if (!req.query.error) { //checks whether a user denied the app facebook login/permissions
            res.redirect(authUrl);
        } else {
            res.status(403).send('access denied');
        }
    }
    // If this branch executes user is already being redirected back with
    // code (whatever that is)
    else {
        console.log("Oauth successful, the code is: ", req.query.code);
        // code is set
        // we'll send that and get the access token
        const client_secret = req.webtaskContext.data.fb_client_secret;
        graph.authorize({
            client_id: config.client_id,
            redirect_uri: config.redirect_uri,
            client_secret: client_secret,
            code: req.query.code
        }, function (err, facebookRes) {
            res.redirect('/fb-photos-words-count/processing');
        });
    }
});

function initClarifai(secret) {
    if (!clarifai) {
        // initialize clarifai if it is not initialized yet
        clarifai = new Clarifai.App(
            config.clarifai_client_id,
            secret
        );
    }
}

function insertDocument(db) {
    return db.collection('words').insertOne({
        list: [],
        ready: false
    });
}

function getPhotosRequest(db, id) {
    return graph.getAsync('me/photos', {fields: 'images', limit: 100, type: 'uploaded'}).then(res => {
        return processPhotosResponse(db, id, res);
    });
}

function processPhotosResponse(db, id, res) {
    let images = res.data.map(entry => entry.images[0].source);
    let updatePromise = Promise.all(images.map(url => photoRecognition(url))).then(results => {
        // combine arrays into one array
        let merged = [];
        results.forEach(el => merged.unshift.apply(merged, el));
        return merged;
    }).then(list => {
        return db.collection('words').updateOne(
           { _id: id },
           { $pushAll: { list } }
        );
    });

    let continuePromise = null;

    if (res.paging && res.paging.next) {
        // fetch next page
        console.log('fetch next page');
        continuePromise = graph.getAsync(res.paging.next).then(res => {
            return processPhotosResponse(db, id, res);
        });
    } else {
        // no more data, set ready flag
        continuePromise = updatePromise.then(res => {
            return db.collection('words').updateOne(
                { _id: id },
                { $set: { ready: true } }
            );
        })
        console.log('end fetching');
    }

    return Promise.all([updatePromise, continuePromise]);
}

function photoRecognition(url) {
    return clarifai.models.predict(Clarifai.GENERAL_MODEL, url).then(res => {
        // select very confident concepts
        const concepts = res && res.outputs && res.outputs[0] &&
            res.outputs[0].data && res.outputs[0].data.concepts || [];
        return concepts.filter(concept => concept.value > 0.9)
            .map(concept => concept.name);
    }).catch(err => {
        console.log('recognition error:', err);
        return [];
    });
}

function renderView(locals) {
  return `
    <!DOCTYPE html>
    <html>
        <head>
            <meta charset="utf-8">
            <title>${locals.title}</title>

            <style>
                .login-btn {
                    padding: 6px 12px;
                    background-color: #286090;
                    border-color: #204d74;
                    color: white;
                    border-radius: 10px;
                    text-decoration: none;
                    font-size: 14px;
                    text-align: center;
                    white-space: nowrap;
                    vertical-align: middle;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    user-select: none;
                }

                .container {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }

                html, body, .container {
                    height: 100%;
                }
            </style>
        </head>

        <body>
            <div class="container">
                <a class="login-btn" href="/fb-photos-words-count/auth">Login with Facebook</a>
            </div>
        </body>
    </html>
  `;
}

function renderProcessingView(locals) {
    return `
      <!DOCTYPE html>
      <html>
          <head>
              <meta charset="utf-8">
              <title>${locals.title}</title>

              <link href="//fonts.googleapis.com/css?family=Finger+Paint" id="link-webfont" rel="stylesheet">
              <script src="//cdnjs.cloudflare.com/ajax/libs/wordcloud2.js/1.0.6/wordcloud2.min.js"></script>
              <script src="//ajax.googleapis.com/ajax/libs/jquery/1/jquery.min.js"></script>

              <style>
                  .container {
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      flex-direction: column;
                  }

                  html, body, .container {
                      height: 100%;
                  }

                  .canvas {
                      width: 800px;
                      height: 520px;
                      display: none;
                  }
              </style>

              <script>
                  var ping = function() {
                      $.get('/fb-photos-words-count/ids/${locals.id}', function(resp) {
                          if (resp && !resp.ready) {
                              setTimeout(ping, 3000);
                          } else if (resp.ready) {
                              $('.progress-label').hide();
                              $('.canvas').show();
                              WordCloud($('.canvas')[0], {
                                  gridSize: 18,
                                  weightFactor: 10,
                                  fontFamily: 'Finger Paint, cursive, sans-serif',
                                  color: '#f0f0c0',
                                  backgroundColor: '#001f00',
                                  list: resp.list
                              });
                          }
                      });
                  };

                  $(document).ready(function() {
                      ping();
                  });
              </script>
          </head>

          <body>
              <div class="container">
                  <div class="progress-label">${locals.content}</div>
                  <canvas class="canvas" width="800" height="520"></canvas>
              </div>
          </body>
      </html>
    `;
}

module.exports = fromExpress(app);
