/**
 * Jingle XMPP extensions, see http://xmpp.org/extensions/xep-0166.html
 *
 * Requires Disco plugin
 *
 * Authors:
 *   - Michael Weibel <michael.weibel@gmail.com>
 *
 * Copyright:
 *   - Michael Weibel <michael.weibel@gmail.com>
 */

if (window.webkitPeerConnection) {
	window.PeerConnection = window.webkitPeerConnection;
	window.URL = window.webkitURL;
	navigator.getUserMedia = navigator.webkitGetUserMedia;
}

Strophe.addConnectionPlugin('jingle', {
	STATUS: {
		BUSY: 1
	},

	_connection: null,
	_peerConnection: null,
	_sdpData: {},
	_sdpMessage: "",
	_status: null,
	_serverConfig: "NONE",
	_localView: null,
	_localStream: null,
	_remoteView: null,
	_remoteStream: null,
	_receiver: false, // indicates if client is receiver or sender
	_sid: "",
	_to: "",
	_successCallback: null,

	init: function(conn) {
		this._connection = conn;

		Strophe.addNamespace('JINGLE', 'urn:xmpp:jingle:1');
		Strophe.addNamespace('JINGLE_ERRORS', 'urn:xmpp:jingle:errors:1');
		Strophe.addNamespace('JINGLE_RTP', 'urn:xmpp:jingle:apps:rtp:1');
		Strophe.addNamespace('JINGLE_RTP_ERRORS', 'urn:xmpp:jingle:apps:rtp:errors:1');
		Strophe.addNamespace('JINGLE_RTP_INFO', 'urn:xmpp:jingle:apps:rtp:info:1');
		Strophe.addNamespace('JINGLE_RTP_AUDIO', 'urn:xmpp:jingle:apps:rtp:audio');
		Strophe.addNamespace('JINGLE_RTP_VIDEO', 'urn:xmpp:jingle:apps:rtp:video');
		Strophe.addNamespace('JINGLE_TRANSPORTS_ICE_UDP', 'urn:xmpp:jingle:transports:ice-udp:1');
		Strophe.addNamespace('JINGLE_TRANSPORTS_RAW_UDP', 'urn:xmpp:jingle:transports:raw-udp:1');
		Strophe.addNamespace('JINGLE_TRANSPORTS_WEBRTC', 'urn:xmpp:jingle:transports:webrtc:1');

		this._connection.disco.addFeature(Strophe.NS.JINGLE);
		this._connection.disco.addFeature(Strophe.NS.JINGLE_TRANSPORTS_WEBRTC);
		this._connection.disco.addFeature(Strophe.NS.JINGLE_RTP);
		this._connection.disco.addFeature(Strophe.NS.JINGLE_RTP_AUDIO);
		this._connection.disco.addFeature(Strophe.NS.JINGLE_RTP_VIDEO);
	},

	/** Function: setServer
	 * Sets STUN/TURN Server to use when connecting.
	 *
	 * Needs to be called before any initSession/accept session occurs
	 *
	 * Parameters:
	 *   (String) config - STUN/TURN Server string, e.g. STUN example.com:3478
	 */
	setServer: function(config) {
		this._serverConfig = config;
	},

	setLocalView: function(el) {
		this._localView = el;
	},

	setRemoteView: function(el) {
		this._remoteView = el;
	},

	_createPeerConnection: function(sdpMessageCallback) {
		var self = this;
		this._peerConnection = new PeerConnection(this._serverConfig, sdpMessageCallback);
		this._peerConnection.onaddstream = function(e) {
			console.info("onaddstream");
			var stream = e.stream,
				url = URL.createObjectURL(stream);
			self._remoteView.attr('src', url);
			self._remoteStream = stream;
		}
		this._peerConnection.onremovestream = function(e) {
			console.info("removestream");
			self._remoteView.attr('src', '');
		}
		this._peerConnection.onmessage = function(e) {
			console.info("onmessage");
			console.log(e);
		}
		this._peerConnection.onopen = function(e) {
			console.info("onopen");
			console.log(e);
		}
		this._peerConnection.onconnecting = function(e) {
			console.info("ONCONNECT");
			console.dir(e);
		}
		this._peerConnection.onstatechange = function(e, state) {
			console.info("ONSTATECHANGE");
			console.dir(e ,state);
		}
		this._peerConnection.addStream(this._localStream);
	},

	_getUserMedia: function(cb) {
		navigator.getUserMedia("video,audio", this._gotStream.bind(this, cb), this._gotStreamFailed.bind(this));
	},

	_gotStream: function(cb, s) {
		var url = URL.createObjectURL(s);
		this._localView.attr('src', url);
		this._localStream = s;
		if (cb) {
			cb();	
		}
	},

	_gotStreamFailed: function(error) {
		console.log("STREAMFAILED");
		console.log(error);
	},

	/** Function: initSession
	 * Sends a session-initialize request to the specified recipient.
	 *
	 * Parameters:
	 *   (String) to - Recipient's jid
	 *   (String) name - Name of the iq request
	 *   (String) media - Media type (audio/video)
	 *   (Function) cb - Callback after successful video establishing
	 */
	initSession: function(to, name, media, cb) {
		var self = this;
		this._status = this.STATUS.BUSY;
		this._to = to;
		this._successCallback = cb;
		this._sid = Math.random().toString(36).substr(10,20);

		this._getUserMedia(function() {
			self._createPeerConnection(function(msg) {
				if (msg.indexOf('OK') !== -1) {
					var iq = $iq({
						'from': self._connection.jid,
						'to': self._to,
						'type': 'set'
					});
					iq.c('jingle', {
						xmlns: Strophe.NS.JINGLE,
						action: 'session-accept',
						initiator: self._connection.jid,
						sid: self._sid
					});
					
					self._sdpToJingle(iq, msg, false);
					
					self._connection.sendIQ(iq);
					
					self._successCallback();
					return;
				}
				if (self._sdpMessage !== "") {
					return;
				}
				self._sdpMessage = msg;

				var iq = $iq({'from': self._connection.jid, 'to': to, 'type': 'set'});
				iq.c('jingle', {
					'xmlns': Strophe.NS.JINGLE, 
					'action': 'session-initiate', 
					'initiator': self._connection.jid, 
					'responder' : to, 
					'sid': self._sid
				});
				self._sdpToJingle(iq, msg);
				self._connection.sendIQ(iq);
			});
		});
	},
	
	_getJSONFromSdp: function(msg) {
		return JSON.parse(msg.substring(4));
	},
	
	/**
	 * From Strophe.js
	 *
	 * License: MIT
	 * Copyright 2006-2008, OGG, LLC
	 */
	_xmlHtmlNode: function (html) {
		if (window.DOMParser) {
			parser = new DOMParser();
			node = parser.parseFromString(html, "text/xml");
		} else {
			node = new ActiveXObject("Microsoft.XMLDOM");
			node.async="false";
			node.loadXML(html);
		}
		return node;
	},

/* --Has to be done by the implementor--
	_delegateJingleIq: function(stanza) {
		var action = stanza.children.item('jingle').getAttribute('action');
		if (action === 'session-initiate') {
			// check if user want's to etc.
			return this.handleSessionInit(stanza);
		} else {
			return this.handle(stanza);
		}
	},
*/

	/** Function: handleSessionInit
	 * Acts upon a session-initiate request and if everything's well,
	 * replies with a session initiate accept result
	 *
	 * Parameters:
	 *   (String) stanza - XMPP Stanza
	 *   (Function) cb - Callback after session-accept or session-terminate has been sent
	 *
	 * Returns:
	 *   (Boolean) - true
	 */
	handleSessionInit: function(stanza, cb) {
		var self = this;
		
		this._getUserMedia(function() {
			var $stanza = $(stanza),
				jingle = $stanza.children('jingle')[0],
				iq = $iq({
					'from': self._connection.jid, 
					'to': $stanza.attr('from'),
					'id': $stanza.attr('id'),
					'type': 'result'
				});

			self._sid = jingle.getAttribute('sid');

			// send ack
			self._connection.send(iq);
			
			if (!self._peerConnection) {
				self._receiver = true;
				self._createPeerConnection(function(msg) {
					if (msg.indexOf('ANSWER') !== -1) {
						var iq = $iq({
							'from': self._connection.jid, 
							'to': $stanza.attr('from'),
							'type': 'set'
						});
						iq.c('jingle', {
							'xmlns': Strophe.NS.JINGLE, 
							'action': 'session-info', 
							'initiator': $stanza.attr('from'), 
							'responder' : self._connection.jid, 
							'sid': self._sid
						});
						self._sdpToJingle(iq, msg);
						self._connection.send(iq);
					}
				});	
			}
			self._peerConnection.processSignalingMessage(self._jingleToSdp(stanza));

			return true;
		});
	},
	
	_generateSdpJsonFromSdp: function(sdp, info) {
		var str = "SDP\n{\n";
		if (info.attr('answererid')) {
			str += "   \"answererSessionId\" : \"" + info.attr('answererid') + "\",\n";
		}
		str += "   \"messageType\" : \"" + info.attr('type') + "\",\n";
		if (info.attr('offererid')) {
			str += "   \"offererSessionId\" : \"" + info.attr('offererid') + "\",\n";
		}
		if (sdp) {
			str += "   \"sdp\" : \"" + sdp + "\",\n";
		}
		str += "   \"seq\" : " + parseInt(info.attr('seq'), 10);
		if (info.attr('tiebreaker')) {
		 	str += ",\n   \"tieBreaker\" : " + parseInt(info.attr('tiebreaker'), 10);
		}
		return str + "\n}";
	},
	
	_jingleToSdp: function(stanza) {
		$stanza = $(stanza),
		jingle = $stanza.children('jingle')[0],
		sdp = SDPToJingle.parseJingleStanza(Strophe.serialize(jingle)),
		$info = $($(jingle).children('webrtc').children('session-info')[0]);
		
	 	return this._generateSdpJsonFromSdp(sdp, $info);
	},
	
	_sdpToJingle: function(iq, msg, dontAppendJingleMedia) {
		if (dontAppendJingleMedia !== false) {
			var jingle = SDPToJingle.createJingleStanza(msg);

			iq.node.appendChild(this._xmlHtmlNode(jingle.audio).documentElement);
			iq.node.appendChild(this._xmlHtmlNode(jingle.video).documentElement);
		}

		var sdpJson = this._getJSONFromSdp(msg);
		iq.c('webrtc', {xmlns: Strophe.NS.JINGLE_TRANSPORTS_WEBRTC});
		
		var sinfo = {
			'type': sdpJson.messageType,
			'seq': sdpJson.seq
		};
		if (sdpJson.offererSessionId) {
			sinfo['offererid'] = sdpJson.offererSessionId;
		}
		if (sdpJson.answererSessionId) {
			sinfo['answererid'] = sdpJson.answererSessionId;
		}
		if (sdpJson.tieBreaker) {
			sinfo['tiebreaker'] = sdpJson.tieBreaker;
		}
		iq.c('session-info', sinfo);
	},
	
	handle: function(stanza) {
		var iq = $iq({
			'from': this._connection.jid,
			'id': stanza.getAttribute('id'),
			'to': stanza.getAttribute('from'),
			'type': 'result'
		});
		
		this._peerConnection.processSignalingMessage(this._jingleToSdp(stanza));
		
		this._connection.sendIQ(iq);

		return true;
	}
 });
