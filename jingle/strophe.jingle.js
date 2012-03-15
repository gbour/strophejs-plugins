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

if (window.webkitPeerConnection || window.webkitDeprecatedPeerConnection) {
	window.PeerConnection = window.webkitPeerConnection || window.webkitDeprecatedPeerConnection;
	window.URL = window.webkitURL;
	navigator.getUserMedia = navigator.webkitGetUserMedia;
}

Strophe.addConnectionPlugin('jingle', (function(self) {
	var STATUS = {
			BUSY: 1
		},
		ERROR = {
			BUSY: 1,
			NOT_SUPPORTED: 2
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
		_initiator = "",
		_response = "",
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
		},

		_recipientSupportsJingle = function(jid) {
			var supportedSpecs = _connection.caps.getCapabilitiesByJid(jid);
			if(supportedSpecs) {
				for(var i = 0, len = supportedSpecs.length; i < len; i++) {
					if (supportedSpecs[i].attributes[0].value === Strophe.NS.JINGLE) {
						return true;
					}
				}
			}
			return false;
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
			
		if (navigator.getUserMedia && window.PeerConnection) {
			_connection.disco.addFeature(Strophe.NS.JINGLE);
			_connection.disco.addFeature(Strophe.NS.JINGLE_TRANSPORTS_WEBRTC);
			_connection.disco.addFeature(Strophe.NS.JINGLE_RTP);
			_connection.disco.addFeature(Strophe.NS.JINGLE_RTP_AUDIO);
			_connection.disco.addFeature(Strophe.NS.JINGLE_RTP_VIDEO);
		}
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

	self.isBusy = function() {
		return _status === STATUS.BUSY;
	};

	/** Function: escapeJid
	 * Escapes a jid (node & resource get escaped)
	 *
	 * See:
	 *   XEP-0106
	 *
	 * Author: Candy by Patrick Stadler & Michael Weibel
	 *         http://candy-chat.github.com/candy
	 *
	 * Parameters:
	 *   (String) jid - Jid
	 *
	 * Returns:
	 *   (String) - escaped jid
	 */
	self.escapeJid = function(jid) {
		var node = Strophe.escapeNode(Strophe.getNodeFromJid(jid)),
			domain = Strophe.getDomainFromJid(jid),
			resource = Strophe.getResourceFromJid(jid);

		jid = node + '@' + domain;
		if (resource) {
			jid += '/' + Strophe.escapeNode(resource);
		}

		return jid;
	};

	/** Function: initSession
	 * Sends a session-initialize request to the specified recipient.
	 *
	 * Parameters:
	 *   (String) responder - Recipient's jid
	 *   (String) name - Name of the iq request
	 *   (String) media - Media type (audio/video)
	 *   (Function) cb - Callback after successful video establishing
	 */
	self.initSession = function(responder, name, media, cb) {
		var self = this;
		_status = STATUS.BUSY;
		_responder = self.escapeJid(responder);
		_initiator = self.escapeJid(_connection.jid);
		_successCallback = cb;
		_sid = Math.random().toString(36).substr(10,20);

		if (!_recipientSupportsJingle(responder)) {
			return false;
		}

		_getUserMedia(function() {
			_createPeerConnection(function(msg) {
				var iq = $iq({'from': _initiator, 'to': _responder, 'type': 'set'}),
					jsonSdp = _getJSONFromSdp(msg);
				if (jsonSdp.messageType === 'OK') {
					iq.c('jingle', {
						xmlns: Strophe.NS.JINGLE,
						action: 'session-accept',
						initiator: _initiator,
						responder: _responder,
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

				iq.c('jingle', {
					'xmlns': Strophe.NS.JINGLE,
					'action': 'session-initiate',
					'initiator': _initiator,
					'responder': _responder,
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
		var self = this,
			$stanza = $(stanza),
			from = $stanza.attr('from');
		if (self.isBusy()) {
			self.rejectSession(ERROR.BUSY, form);
			return false;
		}
		_status = STATUS.BUSY;
		_getUserMedia(function() {
			var jingle = $stanza.children('jingle')[0],
				iq = $iq({
					'from': _connection.jid,
					'to': from,
					'id': $stanza.attr('id'),
					'type': 'result'
				});

			_initiator = from;
			_receiver = true;
			_responder = $stanza.attr('to');
			_sid = jingle.getAttribute('sid');

			// send ack
			_connection.sendIQ(iq);

			if (!_peerConnection) {
				_createPeerConnection(function(msg) {
					var jsonSdp = _getJSONFromSdp(msg);
					if (jsonSdp.messageType === 'ANSWER') {
						var iq = $iq({
							'from': _connection.jid,
							'to': $stanza.attr('from'),
							'type': 'set'
						});
						iq.c('jingle', {
							'xmlns': Strophe.NS.JINGLE,
							'action': 'session-info',
							'initiator': _initiator,
							'responder' : _responder,
							'sid': _sid
						});
						_sdpToJingle(iq, msg);
						_connection.sendIQ(iq);
					}
				});
			}
			_peerConnection.processSignalingMessage(_jingleToSdp(stanza));

			return true;
		});
		return true;
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

		if ($(stanza).children('jingle').attr('action') === 'session-terminate') {
			self.terminate();
		}

		return true;
	};

	self.rejectSession = function(reasonType, to) {
		var iq = $iq({
				'from': _connection.jid,
				'to': to,
				'type': 'error'
			}),
			errorType, reason;

		switch(reasonType) {
			case ERROR.BUSY:
				errorType = 'wait';
				reason = 'resource-constraint';
				break;
			case ERROR.NOT_SUPPORTED:
				errorType = 'cancel';
				reason = 'service-unavailable';
				break;
		}

		iq.c('error', {'type': errorType})
			.c(reason, {'xmlns': Strophe.NS.STANZAS});
		_connection.sendIQ(iq);
	};

	self.terminate = function() {
		_status = null;
		_peerConnection.removeStream(_localStream);
		_peerConnection.removeStream(_remoteStream);
		_peerConnection.remoteStreams[0] = null;
		_peerConnection.close();
		_peerConnection = null;

		var iq = $iq({
			'from': _connection.jid,
			'to': _receiver ? _initiator : _responder,
			'type': 'set'
		});
		iq.c('jingle', {
			'xmlns': Strophe.NS.JINGLE,
			'action': 'session-terminate',
			'initiator': _initiator,
			'responder': _responder,
			'sid': _sid
		})
		.c('reason').c('success');

		_connection.sendIQ(iq);
	};

	return self;
 })({}));
