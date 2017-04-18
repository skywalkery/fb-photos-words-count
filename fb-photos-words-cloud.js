'use latest';

import express from 'express';
import { fromExpress } from 'webtask-tools';
import bodyParser from 'body-parser';
import graph from 'fbgraph';
import Clarifai from 'clarifai';
import { MongoClient, ObjectId } from 'mongodb';
import * as Promise from 'bluebird';

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
    MongoClient.connect(req.webtaskContext.data.mongo_url, function(err, db) {
        if (err) {
            console.log('mongo connect error', err);
            res.status(200).send(err.message);
            return;
        }

        db.collection('words').findOne( { _id: ObjectId(req.params.id) } ).then(doc => {
            let json = doc || {list:[]};
            //console.log(doc.list);
            let counts = json.list.reduce((prev, item) => {
                if (item in prev) prev[item]++;
                else prev[item] = 1;
                return prev;
            }, {});
            console.log(counts);
            json.list = Object.keys(counts).map(key => [key, counts[key]]);
            console.log(json.list);

            res.set('Content-Type', 'application/json');
            res.status(200).send(json);
        });


        db.close();
    });
});

app.get('/processing', (req, res) => {
    if (!clarifai) {
        const clarifai_client_secret = req.webtaskContext.data.clarifai_client_secret;
        clarifai = new Clarifai.App(
            config.clarifai_client_id,
            clarifai_client_secret
        );
    }

    MongoClient.connect(req.webtaskContext.data.mongo_url, function(err, db) {
        if (err) {
            console.log('mongo connect error', err);
            res.status(200).send(err.message);
            return;
        }

        insertDocument(db, function(id) {
            const HTML = renderProcessingView({
              title: 'Processing...',
              content: 'Processing... ' + id,
              id: id
            });
            res.set('Content-Type', 'text/html');
            res.status(200).send(HTML);

            getPhotosRequest(db, id);
        });
    });
});

app.get('/auth', (req, res) => {
    // we don't have a code yet
    // so we'll redirect to the oauth dialog
    if (!req.query.code) {
        console.log("Performing oauth for some user right now.");

        var authUrl = graph.getOauthUrl({
            client_id: config.client_id,
            redirect_uri: config.redirect_uri,
            scope: config.scope
        });

        if (!req.query.error) { //checks whether a user denied the app facebook login/permissions
            res.redirect(authUrl);
        } else {  //req.query.error == 'access_denied'
            res.status(403).send('access denied');
        }
    }
    // If this branch executes user is already being redirected back with
    // code (whatever that is)
    else {
        console.log("Oauth successful, the code (whatever it is) is: ", req.query.code);
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

function insertDocument(db, callback) {
    db.collection('words').insertOne({
        list: [],
        ready: false
    }, (err, result) => {
        callback(result.insertedId);
    });
}

function getPhotosRequest(db, id) {
    graph.get('me/photos', {fields: 'images', limit: 2, type: 'uploaded'}, (p_err, p_res) => {
        let content = '';

        if (p_err) {
            console.log('cannot get photos from fb:', p_err);
            db.close();
        } else {
            processPhotosResponse(db, id, p_err, p_res);
        }
    });
}

function processPhotosResponse(db, id, err, res) {
    let updatePromise;

    if (err) {
        console.log('error while fetching photos:', err);
        updatePromise = Promise.resolve(true);
    } else {
        let images = res.data.map(entry => entry.images[0].source);
        updatePromise = Promise.all(images.map(url => photoRecognition(url))).then(results => {
            let merged = [];
            results.forEach(el => merged.unshift.apply(merged, el));
            db.collection('words').updateOne(
               { _id: id },
               { $pushAll: { list: merged } },
               (err, result) => {
                   if (err) {
                       console.log('cannot update record', err);
                   }
               }
           );
        });
    }

    if (false && res.paging && res.paging.next) {
        console.log('fetch next page');
        graph.get(res.paging.next, (err, res) => {
            processPhotosResponse(db, id, err, res);
        });
    } else {
        updatePromise.then(res => {
            db.collection('words').updateOne(
                { _id: id },
                { $set: { ready: true } },
                (err, res) => {
                    db.close();
                }
            );
        })
        console.log('end fetching');
    }
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
              <script src="https://cdnjs.cloudflare.com/ajax/libs/wordcloud2.js/1.0.6/wordcloud2.min.js"></script>
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
                  }
              </style>

              <script>
                  var ping = function() {
                      $.get('/fb-photos-words-count/ids/${locals.id}', function(resp) {
                          if (resp && !resp.ready) {
                              setTimeout(ping, 3000);
                          } else if (resp.ready) {
                              $('.progress-label').hide();
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
