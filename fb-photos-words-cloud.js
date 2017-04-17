'use latest';

import express from 'express';
import { fromExpress } from 'webtask-tools';
import bodyParser from 'body-parser';
import graph from 'fbgraph';
import Clarifai from 'clarifai';
import { MongoClient, ObjectID } from 'mongodb';

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

app.get('/processing', (req, res) => {
    if (!clarifai) {
        const clarifai_client_secret = req.webtaskContext.data.clarifai_client_secret;
        clarifai = new Clarifai.App(
            config.clarifai_client_id,
            clarifai_client_secret
        );
    }

    graph.get('me/photos', {fields: 'images', limit: 1, type: 'uploaded'}, (p_err, p_res) => {
        let content = '';

        if (p_err) {
            console.log(p_err);
            content = 'Something goes wrong: ' + p_err.message;
        } else {
            //console.log(p_res);
            content = 'Processing...';
            processPhotosResponse(p_err, p_res);
        }

        const HTML = renderProcessingView({
          title: 'Processing...',
          content: content
        });
        res.set('Content-Type', 'text/html');
        res.status(200).send(HTML);
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

function processPhotosResponse(err, res) {
    if (err) {
        console.log('error while fetching photos:', err);
    } else {
        let images = res.data.map(entry => entry.images[0].source);
        console.log(images);
        images.forEach(url => photoRecognition(url));
    }

    if (res.paging && res.paging.next) {
        console.log('fetch next page');
        graph.get(res.paging.next, (err, res) => {
            processPhotosResponse(err, res);
        });
    } else {
        console.log('end fetching');
    }
}

function photoRecognition(url) {
    return clarifai.models.predict(Clarifai.GENERAL_MODEL, url).then(res => {
        // select very confident concepts
        const concepts = res && res.outputs && res.outputs[0] &&
            res.outputs[0].data && res.outputs[0].data.concepts || [];
        let t = concepts.filter(concept => concept.value > 0.9)
            .map(concept => concept.name);
        return t;
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

              <style>
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
                  ${locals.content}
              </div>
          </body>
      </html>
    `;
}

module.exports = fromExpress(app);
