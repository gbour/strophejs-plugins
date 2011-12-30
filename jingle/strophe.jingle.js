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
}

Strophe.addConnectionPlugin('jingle', {
	/** Constant: PAYLOAD_TYPES
	 * Payload types according to WebRTC documentation
	 * 
	 * The ID Attribute (payload type) is not known to me, so correct it if you know
	 * the correct id.
	 */
	PAYLOAD_TYPES: {
		video: [
			{name: 'VP8', 'clockrate': '90000', id: '98'}
		],
		audio: [
			{name: 'isac', 'clockrate': '16000', id: '105'},
			{name: 'isac', 'clockrate': '32000', id: '106'},
			{name: 'iLBC', 'clockrate': '8000', id: '102'}
		]
	},
	STATUS: {
		BUSY: 1
	},

	_connection: null,
	_peerConnection: null,
	_status: null,
	_serverConfig: "NONE",

	init: function(conn) {
		this._connection = conn;

		Strophe.addNamespace('JINGLE', 'urn:xmpp:jingle:1');
		Strophe.addNamespace('JINGLE_ERRORS', 'urn:xmpp:jingle:errors:1');
		Strophe.addNamespace('JINGLE_RTP', 'urn:xmpp:jingle:apps:rtp:1');
		Strophe.addNamespace('JINGLE_RTP_ERRORS', 'urn:xmpp:jingle:apps:rtp:erors:1');
		Strophe.addNamespace('JINGLE_RTP_INFO', 'urn:xmpp:jingle:apps:rtp:info:1');
		Strophe.addNamespace('JINGLE_RTP_AUDIO', 'urn:xmpp:jingle:apps:rtp:audio');
		Strophe.addNamespace('JINGLE_RTP_VIDEO', 'urn:xmpp:jingle:apps:rtp:video');
		Strophe.addNamespace('JINGLE_TRANSPORTS_ICE_UDP', 'urn:xmpp:jingle:transports:ice-udp:1');

		this._connection.disco.addFeature(Strophe.NS.JINGLE);
		this._connection.disco.addFeature(Strophe.NS.JINGLE);
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

	/** Function: initSession
	 * Sends a session-initialize request to the specified recipient.
	 *
	 * Parameters:
	 *   (String) to - Recipient's jid
	 *   (String) name - Name of the iq request
	 *   (String) media - Media type (audio/video)
	 *   (Function) cb - Callback after IQ has been sent
	 */
	initSession: function(to, name, media, cb) {
		var self = this;
		this._status = this.STATUS.BUSY;
		this._peerConnection = new PeerConnection(this._serverConfig, function(msg) {
			var iq = $iq({'from': self._connection.jid, 'to': to, 'type': 'set'});
			iq.c('jingle', {'xmlns': Strophe.NS.JINGLE, 'action': 'session-initiate', 'initiator': self._connection.jid, 'responder' : to, 'sid': 'HAS_TO_BE_GENERATED'});
			iq.c('content', {'creator': 'initiator', 'name': name, 'senders': 'both'});
			iq.c('description', {'xmlns': Strophe.NS.JINGLE_RTP, 'media': media});
			self._attachPayloadTypesAccordingToMedia(iq, media);
			self._attachTransport(iq.up(), msg);
			self._connection.sendIQ(iq, cb);
		});
	},

/* --Has to be done by the implementor--
	_delegateJingleIq: function(stanza) {
		var action = stanza.children.item('jingle').getAttribute('action');
		if (action === 'session-initiate') {
			return this._handleSessionInit(stanza);
		} else if (action === 'session-accept') {
			return this._handleSessionAccept(stanza);
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

		// send ack
		this._connection.send($iq({
			'from': this._connection.jid, 
			'to': stanza.getAttribute('from'),
			'id': stanza.getAttribute('id'),
			'type': 'result'
		}));

		var jingle = stanza.querySelector('jingle'),
			initiator = jingle.getAttribute('initiator'),
			sid = jingle.getAttribute('sid'),
			iq = $iq({
				'from': this._connection.jid,
				'to': stanza.getAttribute('from'),
				'type': 'set'
			});
		iq.c('jingle', {
			'xmlns': Strophe.NS.JINGLE,
			'initiator': initiator,
			'sid': sid
		});
		if (!this._status !== this.STATUS.BUSY) {
			this._status = this.STATUS.BUSY;
			iq.attrs({
				'action': 'session-accept',
				'responder': this._connection.jid
			});
			var content = jingle.querySelector('content');
			iq.c('content', {
				'creator': 'initiator',
				'name': content.getAttribute('name')
			});	
			var description = content.querySelector('description'),
				media = description.getAttribute('media'),
				payloadTypes = description.childNodes,
				payloadTypesLength = payloadTypes.length;
			iq.c('description', {
				'xmlns': Strophe.NS.JINGLE_RTP,
				'media': media
			});
			var payloadTypeSupported = false;
			for (var i = 0; i < payloadTypesLength; i++) {
				var curPayloadType = {},
					attrs = payloadTypes[i].attributes,
					attrsLen = attrs.length;
				for (var a = 0; a < attrsLen; a++) {
					curPayloadType[attrs[a].name] = attrs[a].value;
				}
				if (self._payloadTypeSupported(media, curPayloadType)) {
					iq.c('payload-type', curPayloadType).up();
					payloadTypeSupported = true;
				}
			}

			if (payloadTypeSupported) {
				this._peerConnection = new PeerConnection(this._serverConfig, function(msg) {
					self._attachTransport(iq.up(), msg);
					var id = self._connection.sendIQ(iq);
					self._connection.addHandler(cb, Strophe.NS.JINGLE, 'iq', 'set', id, stanza.getAttribute('from'));
				});
			} else {
				var iq = $iq({
					'from': this._connection.jid,
					'to': stanza.getAttribute('from'),
					'type': 'set',
				});

				iq.c('jingle', {
					'xmlns': Strophe.NS.JINGLE,
					'inititator': inititator,
					'sid': sid,
					'action': 'session-terminate'
				});
				iq.c('reason').c('failed-application');
				this._connection.sendIQ(iq, cb);
				this._status = null;
			}
		} else {
			iq.attrs({'action': 'session-terminate'});
			iq.c('reason').c('busy');
			this._connection.sendIQ(iq, cb);
			this._status = null;
		}

		return true;
	},

	/** Function: handleSessionAccept
	 * After responder sends session-accept, send acknowledge session acceptance
	 * and attempt to establish connectivity using the data channel.
	 *
	 * Parameters:
	 *   (XMLNode) stanza - Session accept message
	 *   (Function) cb - Callback after session acceptance acknowledgement has been sent
	 */
	handleSessionAccept: function(stanza, cb) {
		var iq = $iq({
			'from': this._connection.jid,
			'id': stanza.getAttribute('id'),
			'to': stanza.getAttribute('from'),
			'type': 'result'
		});
		this._connection.sendIQ(iq, cb);

		return true;
	},

	/** Function: handleSessionAcceptResponse
	 * After initiator sent the session acceptance acknowledgement, responder
	 * tries to establish connectivity using the data channel.
	 * 
	 * Parameters:
	 *   (XMLNode) stanza - Session accept acknowledgement message
	 *   (Function) cb - Callback after connectivity has been established
	 */
	handleSessionAcceptResponse: function(stanza, cb) {
		//TODO
		cb();
	},

	/** PrivateFunction: _attachTransport
	 * Attach transport information to iq
	 *
	 * Parameters:
	 *   (Strophe.Builder) content - Child-Node "content" of iq
	 *   (String) msg - SDP Message
	 */
	_attachTransport: function(content, msg) {
		msg = this._parsePeerConnectionMessage(msg);
		content.c('transport', {'xmlns': Strophe.NS.JINGLE_TRANSPORTS_ICE_UDP, 'pwd': msg.pwd, 'ufrag': msg.ufrag});
			
		var candidatesLength = msg.candidates.length;
		for(var i = 0; i < candidatesLength; i++) {
			content.c('candidate', msg.candidates[i]).up();
		}
	},

	/** PrivateFunction: _payloadTypeSupported
	 * Checks if specified payload type is supported
	 *
	 * FIXME: This is ugly & maybe not the correct way on how to do it.
	 *
	 * Parameters:
	 *   (String) media - audio/video
	 *   (Object) payloadType - Payload type to check
	 *
	 * Returns:
	 *   (Boolean) - true/false
	 */
	_payloadTypeSupported: function(media, payloadType) {
		var supportedPayloadTypesLength = this.PAYLOAD_TYPES[media].length;
		var supported = false;
		for (var i = 0; i < supportedPayloadTypesLength; i++) {
			var curPayloadType = this.PAYLOAD_TYPES[media][i];
			for(var key in curPayloadType) {
				if(payloadType[key] === curPayloadType[key]) {
					supported = true;
				} else {
					supported = false;
				}
			}
			if (supported) {
				return true;
			}
		}
		return false;
	},

	/** PrivateFunction: _parsePeerConnectionMessage
	 * Parse peer connection msg from STUN/TURN Server
	 *
	 * This parsing was done using only one example (from the
	 * built-in STUN server of ejabberd) so it may be incomplete
	 * inacurrate and also the code is ugly.
	 *
	 * Improving it would be nice :)
	 *
	 * Parameters:
	 *   (String) msg - Reply from the STUN/TURN Server
	 *
	 * Returns:
	 *   (Object) - Object containing parsed connection message
	 */
	_parsePeerConnectionMessage: function(msg) {
		var lines = msg.split("\n"),
			protocol = lines[0],
			lineCount = lines.length,
			ret = {
				'protocol': protocol,
				'candidates': []
			};
		for(var i = 1; i < lineCount; i++) {
			var line = lines[i].split("=");
			if (!line[1]) {
				continue;
			}
			line = line[1].split(" ");
			var identifier = line[0].split(":");
			if (identifier[0] == "candidate") {
				var id = MD5.hexdigest(line[2] + line[3] + line[4] + line[5] + line[7]);
				ret.candidates.push({
					'foundation': identifier[1],
					'generation': 0, //FIXME
					'network': 0, // FIXME
					'component': line[1],
					'protocol': line[2],
					'priority': line[3],
					'ip': line[4],
					'port': line[5],
					'type': line[7],
					'id': id
				});
			} else if(identifier[0] == "ice-ufrag") {
				ret.ufrag = identifier[1];
			} else if(identifier[0] == "ice-pwd") {
				ret.pwd = identifier[1];
			}
		}

		return ret;
	},

	/** PrivateFunction: _attachPayloadTypesAccordingToMedia
	 * Attach payload types to the description-node
	 *
	 * Maybe put those payload-types into a user-overridable constant.
	 * Parameters:
	 *   (Strophe.Builder) description - Description node
	 *   (String) media - Media type (audio/video)
	 */
	_attachPayloadTypesAccordingToMedia: function(description, media) {
		var payloadTypes = [];
		switch(media) {
			case 'video':
				payloadTypes = this.PAYLOAD_TYPES.video;
				break;
			case 'audio':
				payloadTypes = this.PAYLOAD_TYPES.audio;
				break;
		}
		var payloadTypesLength = payloadTypes.length;
		for(var i = 0; i < payloadTypesLength; i++) {
			description.c('payload-type', payloadTypes[i]).up();
		}
	}

 });
