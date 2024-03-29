"use strict";

// Boilerplate server setup.
const express = require('express');
const http = require('http');
const port = 51490;

// Login/authentication setup.
const passport = require('passport');
const googleAuth = require('passport-google-oauth20');
const cookieSession = require('cookie-session');

// Google Translate API setup.
const APIrequest = require('request');
const APIkey = "AIzaSyD5oG-6TYOgYT4gq-y5vg-YcNy14mCtjuc";  // ADD API KEY HERE
const url = "https://translation.googleapis.com/language/translate/v2?key=" + APIkey;

// SQLite3 database setup.
const sqlite3 = require('sqlite3').verbose();  // use sqlite
const fs = require('fs'); // file system
const dbFileName = "Flashcards.db";
// makes the object that represents the database in our code
const db = new sqlite3.Database(dbFileName);  // object, not database.

// Initialize table.
// If the table already exists, causes an error.
// Fix the error by removing or renaming Flashcards.db
let cmdStr = 'CREATE TABLE flashcards (id TEXT, source TEXT, target TEXT, seen INT, correct INT)';
db.run(cmdStr,tableCreationCallback);

cmdStr = 'CREATE TABLE profiles (id TEXT UNIQUE, username TEXT)';
db.run(cmdStr,tableCreationCallback);


// An object containing the data expressing the query to the translate API.
// Below, gets stringified and put into the body of an HTTP PUT request.
let requestObject = {
    "source": "en",
    "target": "ko",
    "q": ["Hello!"]
};

// Object sent to google telling them that the domain is registered to them.
// Google sends key packed into redirect response that redirects to server162.site:51490/auth/redirect
const googleLoginData = {
    clientID: '695831622286-b9htqlrt0c1n001m13uj59tvru4nm4on.apps.googleusercontent.com',
    clientSecret: '54-saBVCpICdiGcGfGK8OZT0',
    callbackURL: '/auth/redirect'
};


// Strategy configuration.
// Tell passport we will be using login with Google, and
// give it our data for registering us with Google.
// The gotProfile callback is for the server's HTTPS request
// to Google for the user's profile information.
// It will get used much later in the pipeline.
passport.use( new googleAuth(googleLoginData, gotProfile) );

// Always use the callback for database operations and print out any
// error messages you get.
// This database stuff is hard to debug, give yourself a fighting chance.
function tableCreationCallback(err) {
    if (err) {
	console.log("Table creation error",err);
    } else {
	console.log("Database created");
	//db.close();
    }
}

console.log("English phrase: ", requestObject.q[0]);

// Serve homepage with the lango app page by default.
function initialHandler(req, res) {
    res.redirect('/user/lango.html');
}

function isAuthenticated(req, res, next) {
    if (req.user) {
        next();
    }
    else {
        // Go to login page.
        res.redirect('/login.html');
    }
}

function translateQueryHandler(req, res, next) {
    let qObj = req.query;
    console.log(qObj);
    if (qObj.source != undefined) {
        requestObject.q = [qObj.source];
        translateAPI(res);
    } else {
        next();
    }
}

function storeQueryHandler(req, res, next) {
    // TODO: Delete these printouts later.
    console.log("Inside storeQueryHandler, testing if username and ID got passed in.");
    console.log("google user ID: " + req.user.id);
    console.log("username: " + req.user.username);

    let url = req.url;
    let qObj = req.query;
    console.log(qObj);
    if (qObj.source != '' && qObj.target != '') {
	//Setting default values (right now ID is 0, but we will change that later)
	let sqliteQuery = `INSERT INTO flashcards VALUES ("${req.user.id}", "${qObj.source}", "${qObj.target}",0,0)`;
        db.run(sqliteQuery, function(err) {
            if (err) {
                return console.log(err.message);
            }
            dumpDB();
            res.json({"msg":"saved"});
        });
    } else {
        next();
    }

}

function requestUsernameHandler(req, res, next) {
    db.all ( `SELECT * FROM flashcards WHERE id = "${req.user.id}"`, dataCallback);
    function dataCallback( err, data ) {
	if (err) {
	    return console.log(err.message);

	}

	res.json({id : req.user.id, username : req.user.username, cards : data});
    }
}

function dumpDB() {
    db.all ( 'SELECT * FROM profiles', dataCallback);
    db.all ( 'SELECT * FROM flashcards', dataCallback);
    function dataCallback( err, data ) {console.log(data)}
}

function translateAPI (res) {
    APIrequest(
        { // HTTP header stuff
            url: url,
            method: "POST",
            headers: {"content-type": "application/json"},
            // will turn the given object into JSON
            json: requestObject
        },
        // callback function for API request
        APIcallback
    );

    function APIcallback (err, APIresHead, APIresBody) {
        if ((err) || (APIresHead.statusCode != 200)) {
            // API is not working
            console.log("Got API error");
            console.log(APIresBody);
        }
        else {
            if (APIresHead.error) {
                // API worked but is not giving you data
                console.log(APIresHead.error);
            }
            else {
                console.log("In source language: ",
                    APIresBody.data.translations[0].translatedText);
                console.log("\n\nJSON was:");
                console.log(JSON.stringify(APIresBody, undefined, 2));
                // print it out as a string, nicely formatted
                res.json({
                    "source" : requestObject.q[0], // Or wherever you have your english phrase contained
                    "target" : APIresBody.data.translations[0].translatedText
                });
            }
        }
    }
}

function fileNotFound(req, res) {
    let url = req.url;
    res.type('text/plain');
    res.status(404);
    res.send('Cannot find '+url);
}

// Some functions Passport middleware function calls.
// The callback "done" at the end of each call resumes Passport's internal process.

// function called during login, the second time passport.authenticate
// is called (in /auth/redirect/), once we actually have the profile data from Google.
function gotProfile(accessToken, refreshToken, profile, done) {
    console.log("Inside gotProfile: Google profile id is ", profile.id);

    // Idea: We declared the id column as UNIQUE. Therefore,
    // if the user id already exists in the table, then the
    // callback will return an error message and the user will not
    // get re-inserted into the table. Else, insert into table,
    // and output the table to the console.
    let sqliteQuery = `INSERT INTO profiles VALUES ("${profile.id}", "${profile.displayName}")`;
        db.run(sqliteQuery, function(err) {
            if (err) {
                return console.log(err.message);
            }
            dumpDB();
        });

    // Second arg to "done" will be passed into serializeUser,
    // should be key to get user out of database.
    let dbRowID = profile.id;
    done(null, dbRowID);
}

// Part of Server's sesssion set-up.
// The second operand of "done" becomes the input to deserializeUser
// on every subsequent HTTP request with this session's cookie.
passport.serializeUser((dbRowID, done) => {
    done(null, dbRowID);
});

// Called by passport.session pipeline stage on every HTTP request with
// a current session cookie.
// Where we should lookup user database info.
// Whatever we pass in the "done" callback becomes req.user
// and can be used by subsequent middleware.
passport.deserializeUser((dbRowID, done) => {
    let sqliteQuery = `SELECT id, username FROM profiles WHERE id = "${dbRowID}"`;
    db.get(sqliteQuery, function(err, row) {
        let userData = {};
        if (err) {
            return console.log(err.message);
        }
        else {
            console.log("Inside deserializeUser");
            userData = {
                id: row.id,
                username: row.username
            };
        }
        done(null, userData);
    });

});


// Put together the server pipeline.
const app = express();

// Setting up the cookie stage.
// maxAge controls how long the session will last (Here, it is 6 hours in milliseconds).
// keys is a list of random keys used to cryptographically sign the session.
app.use(cookieSession({
    maxAge: 6*60*60*1000,
    keys: ['lomo saltado is a tasty dish']
}));

// Setting up the passport stage (login and session setup).
// session() attaches user info to req in req.user.
// It then calls a function deserializeUser, which we write.
// That function can take info out of an sqlite3 User database table
// based on an input userID.
app.use(passport.initialize());
app.use(passport.session());

app.get('/*',express.static('public'));  // can I find a static file?

// Starts login by redirecting to Google. login.html redirects to here (no AJAX involved).
// The object { scope: ['profile'] } says to ask Google for their user profile information.
app.get('/auth/google',
    passport.authenticate('google',{ scope: ['profile'] }) );

// After successful login, redirect to here and run three handler functions one after another.
app.get('/auth/redirect',
	function (req, res, next) {
        console.log("at auth/redirect");
        next();
    },
    // Server issues HTTPS request to google to access user profile with given request key.
    passport.authenticate('google'),
    // then it will run the "gotProfile" callback function,
    // set up the cookie, call serialize, whose "done"
    // will come back here to send back the response
    // ...with a cookie in it for the Browser!
	function (req, res) {
        console.log('Logged in and using cookies!');
        res.redirect('/user/lango.html');
    });

// Serve files inside user directory only if user is authenticated.
app.get('/user/*', isAuthenticated, express.static('.'));

app.get('/', initialHandler);

// query handlers.
app.get('/user/translate', translateQueryHandler );   // if not, is it a valid query?
app.get('/user/store', storeQueryHandler );
app.get('/user/request', requestUsernameHandler );

app.use( fileNotFound );            // otherwise not found
app.listen(port, function () { console.log('Listening on port ' + port); } );
//db.close()
