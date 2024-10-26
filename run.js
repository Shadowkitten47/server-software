const bedrock = require('bedrock-protocol')
const { CURRENT_VERSION } = require('bedrock-protocol/src/options')

const fs = require('fs')
const util = require('util')

function debug(...msg) {
    console.log(...msg)
}

const relay = new bedrock.Relay(
    {
        host: '0.0.0.0',
        port: 19564,
        offline: false,
        
        noLoginForward: true,
        destination: {
            host: '208.73.202.75',
            port: 19322,
            offline: true
        }
    }
)

//Redfine Naming
relay.openUpstreamConnection = async function(ds, clientAddr) {
    console.warn("HELLO")
    const options = {
      authTitle: this.options.authTitle,
      flow: this.options.flow,
      deviceType: this.options.deviceType,
      offline: true,
      username: ds.profile.name,
      version: CURRENT_VERSION,
      realms: this.options.destination.realms,
      host: this.options.destination.host,
      port: this.options.destination.port,
      batchingInterval: this.options.batchingInterval,
      onMsaCode: (code) => {
        if (this.options.onMsaCode) {
          this.options.onMsaCode(code, ds)
        } else {
          ds.disconnect("It's your first time joining. Please sign in and reconnect to join this server:\n\n" + code.message)
        }
      },
      profilesFolder: this.options.profilesFolder,
      backend: this.options.backend,
      autoInitPlayer: false
    }

    if (this.options.destination.realms) {
      await realmAuthenticate(options)
    }

    const client = new bedrock.Client(options)
    console.warn(client)
    // Set the login payload unless `noLoginForward` option
    if (!client.noLoginForward) client.options.skinData = ds.skinData
    client.ping().then(pongData => {
      client.connect()
    }).catch(err => {
      this.emit('error', err)
    })
    this.conLog('Connecting to', options.host, options.port)
    client.outLog = ds.upOutLog
    client.inLog = ds.upInLog
    client.once('join', () => {
      // Tell the server to disable chunk cache for this connection as a client.
      // Wait a bit for the server to ack and process, the continue with proxying
      // otherwise the player can get stuck in an empty world.
      client.write('client_cache_status', { enabled: this.enableChunkCaching })
      ds.upstream = client
      ds.flushUpQueue()
      this.conLog('Connected to upstream server')
      client.readPacket = (packet) => ds.readUpstream(packet)

      this.emit('join', /* client connected to proxy */ ds, /* backend server */ client)
    })
    client.on('error', (err) => {
      ds.disconnect('Server error: ' + err.message)
      debug(clientAddr, 'was disconnected because of error', err)
      this.upstreams.delete(clientAddr.hash)
    })
    client.on('close', (reason) => {
      ds.disconnect('Backend server closed connection:\n' + reason)
      this.upstreams.delete(clientAddr.hash)
    })

    this.upstreams.set(clientAddr.hash, client)
  }


relay.conLog = console.debug
bedrock.ping(relay.options.destination).then((res) => {
  console.warn(res)
  console.info("PONG! Sever is online!")
  relay.advertisement = res;
  relay.advertisement.portV4 = relay.options.port;
  relay.advertisement.portV6 = relay.options.port;
  console.info("Starting Proxy...")
  relay.listen()
})

const commands = JSON.parse(fs.readFileSync('commands.json'))
const commandCB = {
    ban: function (args) {
        console.log(args)
                client.write('command_output', {
                    output: 'Banned ' + args.target + ' for ' + args.reason
                })
            }
    }

relay.on('connect', (client) => {
    console.log("Connected!")
    client.once('login', (packet) => {
        client.on('clientbound', ({ name, params }, des) => {
                if ( name == "available_commands") {
                    commands.forEach(cmd => {
                        const find = params['command_data'].findIndex(x => x.name == cmd.name)
                        if (find != -1) {
                            params['command_data'][find] = cmd
                        }
                        else params['command_data'].push(cmd)
                    });
                }
          })

        client.on('serverbound', ({ name, params }, des) => {
                switch (name) {
                    case 'command_request':
                        const args = params['command'].replace('/', '').split(' ')
                        if (commandCB[args[0]?.toLowerCase()]) {
                            commandCB[args[0].toLowerCase()](args)
                        }
                        break;
                }
        })
    })
})

