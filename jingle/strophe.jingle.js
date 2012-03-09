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

Strophe.addConnectionPlugin('jingle', (function(self) {
	var STATUS = {
			BUSY: 1
		},
		_connection = null,
		_peerConnection = null,
		_sdpData = {},
		_sdpMessage = "",
		_status = null,
		_serverConfig = "NONE",
		_localView = null,
		_localStream = null,
		_remoteView = null,
		_remoteStream = null,
		_receiver = false, // indicates if client is receiver or sender
		_sid = "",
		_to = "",
		_successCallback = null,

		_createPeerConnection = function(sdpMessageCallback) {
			var self = this;
			_peerConnection = new PeerConnection(_serverConfig, sdpMessageCallback);
			_peerConnection.onaddstream = function(e) {
				console.info("onaddstream");
				var stream = e.stream,
					url = URL.createObjectURL(stream);
				_remoteView.attr('src', url);
				_remoteStream = stream;
			}
			_peerConnection.onremovestream = function(e) {
				console.info("removestream");
				_remoteView.attr('src', '');
			}
			_peerConnection.onmessage = function(e) {
				console.info("onmessage");
				console.log(e);
			}
			_peerConnection.onopen = function(e) {
				console.info("onopen");
				console.log(e);
			}
			_peerConnection.onconnecting = function(e) {
				console.info("ONCONNECT");
				console.dir(e);
			}
			_peerConnection.onstatechange = function(e, state) {
				console.info("ONSTATECHANGE");
				console.dir(e ,state);
			}
			_peerConnection.addStream(_localStream);
		},

		_getUserMedia = function(cb) {
			navigator.getUserMedia("video,audio", _gotStream.bind(this, cb), _gotStreamFailed.bind(this));
		},

		_gotStream = function(cb, s) {
			var url = URL.createObjectURL(s);
			_localView.attr('src', url);
			_localStream = s;
			if (cb) {
				cb();
			}
		},

		_gotStreamFailed = function(error) {
			console.log("STREAMFAILED");
			console.log(error);
		},
		_getJSONFromSdp = function(msg) {
			return JSON.parse(msg.substring(4));
		},

		/**
		 * From Strophe.js
		 *
		 * License: MIT
		 * Copyright 2006-2008, OGG, LLC
		 */
		_xmlHtmlNode = function (html) {
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
		_generateSdpJsonFromSdp = function(sdp, info) {
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

		_jingleToSdp = function(stanza) {
			var $stanza = $(stanza),
				jingle = $stanza.children('jingle')[0],
				sdp = SDPToJingle.parseJingleStanza(Strophe.serialize(jingle)),
				$info = $($(jingle).children('webrtc').children('session-info')[0]);

		 	return _generateSdpJsonFromSdp(sdp, $info);
		},

		_sdpToJingle = function(iq, msg, dontAppendJingleMedia) {
			if (dontAppendJingleMedia !== false) {
				var jingle = SDPToJingle.createJingleStanza(msg);

				iq.node.appendChild(_xmlHtmlNode(jingle.audio).documentElement);
				iq.node.appendChild(_xmlHtmlNode(jingle.video).documentElement);
			}

			var sdpJson = _getJSONFromSdp(msg),
				sinfo = {
					'type': sdpJson.messageType,
					'seq': sdpJson.seq
				};
			iq.c('webrtc', {xmlns: Strophe.NS.JINGLE_TRANSPORTS_WEBRTC});

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
		};

	self.init = function(conn) {
		_connection = conn;

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

		_connection.disco.addFeature(Strophe.NS.JINGLE);
		_connection.disco.addFeature(Strophe.NS.JINGLE_TRANSPORTS_WEBRTC);
		_connection.disco.addFeature(Strophe.NS.JINGLE_RTP);
		_connection.disco.addFeature(Strophe.NS.JINGLE_RTP_AUDIO);
		_connection.disco.addFeature(Strophe.NS.JINGLE_RTP_VIDEO);
	};

	/** Function: setServer
	 * Sets STUN/TURN Server to use when connecting.
	 *
	 * Needs to be called before any initSession/accept session occurs
	 *
	 * Parameters:
	 *   (String) config - STUN/TURN Server string, e.g. STUN example.com:3478
	 */
	self.setServer = function(config) {
		_serverConfig = config;
	};

	self.setLocalView = function(el) {
		_localView = el;
	};

	self.setRemoteView = function(el) {
		_remoteView = el;
	};



	/** Function: initSession
	 * Sends a session-initialize request to the specified recipient.
	 *
	 * Parameters:
	 *   (String) to - Recipient's jid
	 *   (String) name - Name of the iq request
	 *   (String) media - Media type (audio/video)
	 *   (Function) cb - Callback after successful video establishing
	 */
	self.initSession = function(to, name, media, cb) {
		var self = this;
		_status = this.STATUS.BUSY;
		_to = to;
		_successCallback = cb;
		_sid = Math.random().toString(36).substr(10,20);

		_getUserMedia(function() {
			_createPeerConnection(function(msg) {
				if (msg.indexOf('OK') !== -1) {
					var iq = $iq({
						'from': _connection.jid,
						'to': _to,
						'type': 'set'
					});
					iq.c('jingle', {
						xmlns: Strophe.NS.JINGLE,
						action: 'session-accept',
						initiator: _connection.jid,
						sid: _sid
					});

					_sdpToJingle(iq, msg, false);

					_connection.sendIQ(iq);

					_successCallback();
					return;
				}
				if (_sdpMessage !== "") {
					return;
				}
				_sdpMessage = msg;

				var iq = $iq({'from': _connection.jid, 'to': to, 'type': 'set'});
				iq.c('jingle', {
					'xmlns': Strophe.NS.JINGLE,
					'action': 'session-initiate',
					'initiator': _connection.jid,
					'responder' : to,
					'sid': _sid
				});
				_sdpToJingle(iq, msg);
				_connection.sendIQ(iq);
			});
		});
	};

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
	self.handleSessionInit = function(stanza, cb) {
		var self = this;
		_status = this.STATUS.BUSY;
		_getUserMedia(function() {
			var $stanza = $(stanza),
				jingle = $stanza.children('jingle')[0],
				iq = $iq({
					'from': _connection.jid,
					'to': $stanza.attr('from'),
					'id': $stanza.attr('id'),
					'type': 'result'
				});

			_sid = jingle.getAttribute('sid');

			// send ack
			_connection.send(iq);

			if (!_peerConnection) {
				_receiver = true;
				_createPeerConnection(function(msg) {
					if (msg.indexOf('ANSWER') !== -1) {
						var iq = $iq({
							'from': _connection.jid,
							'to': $stanza.attr('from'),
							'type': 'set'
						});
						iq.c('jingle', {
							'xmlns': Strophe.NS.JINGLE,
							'action': 'session-info',
							'initiator': $stanza.attr('from'),
							'responder' : _connection.jid,
							'sid': _sid
						});
						_sdpToJingle(iq, msg);
						_connection.send(iq);
					}
				});
			}
			_peerConnection.processSignalingMessage(_jingleToSdp(stanza));

			return true;
		});
	};

	self.handle = function(stanza) {
		var iq = $iq({
			'from': _connection.jid,
			'id': stanza.getAttribute('id'),
			'to': stanza.getAttribute('from'),
			'type': 'result'
		});

		_peerConnection.processSignalingMessage(_jingleToSdp(stanza));

		_connection.sendIQ(iq);

		return true;
	};

	return self;
 })({}));
