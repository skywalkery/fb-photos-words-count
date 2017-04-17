'use latest';

import express from 'express';
import { fromExpress } from 'webtask-tools';
import bodyParser from 'body-parser';
import graph from 'fbgraph';

const config = {
    client_id: '1429175207143662',
    scope: 'user_photos',
    redirect_uri: 'https://wt-50a4b43389d58ef63e72f1a6ecc08cbb-0.run.webtask.io/fb-photos-words-count/auth'
};

const app = express();

app.use(bodyParser.json());

app.get('/', (req, res) => {
  const HTML = renderView({
    title: 'FB Photos Words Cloud',
  });

  res.set('Content-Type', 'text/html');
  res.status(200).send(HTML);
});

app.get('/logged', (req, res) => {
    const HTML = renderLoggedView({
      title: 'Processing...',
    });

    res.set('Content-Type', 'text/html');
    res.status(200).send(HTML);
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
            res.redirect('/fb-photos-words-count/logged');
        });
    }
});

module.exports = fromExpress(app);

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

function renderLoggedView(locals) {
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
                  Logged
              </div>
          </body>
      </html>
    `;
}
