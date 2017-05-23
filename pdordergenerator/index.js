
exports.pdordergenerator = function(req, res) {
  if (req.body.contents === undefined) {
    // This is an error case, as "message" is required
    res.status(400).send('No message defined!');
  }
  else {
console.log('in');
    // initialize the thing
    var efx = Exchange.init(req.body.contents).handle;
console.log ('efx init');
efx.ping().then (function(d) { console.log (d.data);});
    // and set the session to this app name for future info
    efx.setSession("pd-order-generator");
    var keys = efx.getKeys();
console.log ('keys',keys);
    // now read the given item, with an intention to update, and also activate exp backoff 
    efx.read(keys.item, keys.updater, {
        "intention": "update",
        "backoff":true
      })
      .then(function(result) {
        // kick off making a new point
        if (!result.data.ok) throw result.data;
        MakePoint.init(result.data.value, keys);
        return Promise.all([MakePoint.getPoint(), Promise.resolve(result.data)]);
      })
      .then(function(result) {
        // take the first resukts
        var data = result[1];
        var item = result[0];
        
        if (item) {
          // all that happens is that no random order is created if cant get a point
          data.value.points.push(item);

          // write back to the thing
          return efx.update(data.value, keys.item, keys.updater, "post", {
            intent: data.intent
          });
        }
        else {
          return {
            data: data
          };
        }
      })
      .then(function(result) {
        if (!result.data.ok) throw result.data;
        res.status(200).end();
      })
      .catch(function(err) {
        console.log('err', err);
        res.status(500).end();
      });


  }

};

// namespace for making a point
var MakePoint = (function(ns) {

  var pp = require('point-in-polygon');
  ns.maps = require('@google/maps');


  ns.data = {};
  ns.settings = {
    maxTries: 100
  };


  // set up the polygon that we're working with
  ns.init = function(value, keys) {

    // point in polygon uses a different format
    var poly = value.polygon;
    ns.data.ll = poly.map(function(d) {
      return ns.llToArray(d);
    });
    ns.data.poly = poly;
    ns.data.keyRow = value.keys;

    // set the bounds max & mins
    ns.data.limits = {
      sw: poly.reduce(function(p, c) {
        return typeof p.lat === typeof undefined ? c : {
          lat: Math.min(p.lat, c.lat),
          lng: Math.min(p.lng, c.lng)
        };
      }, {}),
      ne: poly.reduce(function(p, c) {
        return typeof p.lat === typeof undefined ? c : {
          lat: Math.max(p.lat, c.lat),
          lng: Math.max(p.lng, c.lng)
        };
      }, {}),
    };

    ns.data.googleMapsClient = ns.maps.createClient({
      key: keys.mapsApiKey,
      Promise: Promise
    });

  };

  /** convert {lat:,lng} to an array
   */
  ns.llToArray = function(ll) {
    return [ll.lng, ll.lat];
  };

  /**
   * get a random point inside the poly
   */
  ns.getPoint = function() {
    var point = getPoint_();

    var request = {
      language: 'en',
      location: point,
      rankby: 'distance',
      type: ns.data.keyRow['places-type']
    };

    return ns.data.googleMapsClient.placesNearby(request)
      .asPromise()
      .then(function(places) {
        // i've only taken the first default page
        // if there's nothing there then just pass on this one
       
        // pick the first one still in the zone
        if (places.json.status === "OK") {

          return places.json.results.reduce(function(p, c) {

            if (!p && c.vicinity && ns.inside(c.geometry.location)) {
              p = {
                "icon": c.icon,
                "name": c.name,
                "place_id": c.place_id,
                "vicinity": c.vicinity,
                "photos": c.photos,
                "lat":c.geometry.location.lat,
                "lng":c.geometry.location.lng
              };
            }
            return p;
          }, null);
        }
        else {
          return null;
        }
      });


  };

  function getPoint_() {
    for (var p = 0; p < ns.settings.maxTries; p++) {
      var point = {
        lat: Math.random() * (ns.data.limits.ne.lat - ns.data.limits.sw.lat) + ns.data.limits.sw.lat,
        lng: Math.random() * (ns.data.limits.ne.lng - ns.data.limits.sw.lng) + ns.data.limits.sw.lng
      };
      if (ns.inside(point)) return point;
    }
    throw 'unable to get a random point after ' + ns.settings.maxTries + ' times ';
  }

  /**
   * makebounds- dont have access to the geometry functions in maps, so use this
   * @param 
   */
  ns.inside = function(point) {
    return pp(ns.llToArray(point), ns.data.ll);
  };

  return ns;

})({});


// namespace for efx conversations
var Exchange = (function(ns) {

  // open efx
  ns.handle = require('effex-api-client');
  ns.settings = {
    instance: 'prod'
  };

  // initialize for conversation with store
  ns.init = (content) => {

    // pick the instance
    ns.handle.setEnv(ns.settings.instance);

    // set the keys
    ns.handle.setKeys({
      id: content.id,
      alias: content.alias,
      updater: content.message && content.message.updater,
      item: content.item || content.alias || content.id,
      mapsApiKey: content.message && content.message.mapsApiKey
    });


    return ns;

  };


  return ns;
})({});

