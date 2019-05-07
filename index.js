const pUrl = require('url')

const { config, persist } = require('internal')

const needle = require('needle')
const cheerio = require('cheerio')

const defaults = {
	name: 'Unlim.tv IPTV',
	prefix: 'unlimtv_',
	endpoint: 'https://unlim.tv/',
	icon: 'https://www.unlim.tv/assets/img/logo_white.svg'
}

let genres = []
let categories = []
let catalogs = []
let channels = {}
let token, cookies, origin, endpoint, ajaxEndpoint

const headers = {
	'Accept': 'text/plain, */*; q=0.01',
	'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36',
	'X-Requested-With': 'XMLHttpRequest'
}

function setEndpoint(str) {
	if (str) {
		let host = str
		if (host.endsWith('/index.php'))
			host = host.replace('/index.php', '/')
		if (!host.endsWith('/'))
			host += '/'
		endpoint = host
		origin = endpoint.replace(pUrl.parse(endpoint).path, '')
		ajaxEndpoint = endpoint + 'includes/ajax-control.php'
		headers['Origin'] = origin
		headers['Referer'] = endpoint
	}
	return true
}

setEndpoint(config.host || defaults.endpoint)

function setCatalogs(cats) {
	categories = cats
	if (config.style == 'Catalogs') {
		catalogs = []
		cats.forEach(cat => {
			catalogs.push({
				id: defaults.prefix + 'cat_' + cat.id,
				name: cat.name,
				type: 'tv',
				extra: [{ name: 'search' }]
			})
		})
	} else if (config.style == 'Filters') {
		genres = categories.map(el => { return el.name })
		catalogs = [
			{
				id: defaults.prefix + '_cat',
				name: defaults.name,
				type: 'tv',
				genres,
				extra: [{ name: 'genre' }]
			}
		]
	} else if (config.style == 'Channels') {
		catalogs = [
			{
				id: defaults.prefix + '_cat',
				name: defaults.name,
				type: 'tv',
				extra: [{ name: 'search' }]
			}
		]
	}
	return true
}

//setCatalogs(defaults.categories)

function catToMeta(cat) {
	return {
		id: defaults.prefix + 'cat_' + cat.id,
		name: cat.name,
		logo: defaults.icon,
		type: 'channel',
		posterShape: 'square'
	}
}

function catToVideo(cat) {
	return {
		id: cat.id,
		title: cat.name,
		thumbnail: cat.poster
	}
}

let loggedIn = false

// not using logout anywhere yet
function logout(cb) {
	const payload = 'action=logoutProcess'
	needle.post(ajaxEndpoint, payload, { headers, cookies }, (err, resp, body) => {
		if (!err) {
			loggedIn = false
			cookies = undefined
			cb(true)
		} else
			cb()
	})
}

function isLogedIn(cb) {
	if (loggedIn)
		return cb(true)
	const payload = 'email='+encodeURIComponent(config.email)+'&password='+encodeURIComponent(config.password)
	needle.post(config.host + 'login/do', { email: config.email, password: config.password }, { headers, rejectUnauthorized: false }, (err, resp, body) => {
		if (body) {
			cookies = resp.cookies
			if (typeof body == 'string') {
				try {
					body = JSON.parse(body)
				} catch(e) {
					console.log(defaults.name + ' - Error')
					console.error(e.message || 'Unable to parse JSON response from ' + defaults.name + ' server')
				}
			}
			if (body.status == 1) {
				// login success
				loggedIn = true
				console.log(defaults.name + ' - Logged In')
				getCategories(success => {
					if (success)
						console.log(defaults.name + ' - Updated catalogs successfully')
					else
						console.log(defaults.name + ' - Could not update catalogs from server')

					cb(true)
				})
			} else {
				// login fail
				console.log(defaults.name + ' - Error')
				console.error(body.message || 'Failed to log in')
				cb()				
			}
		} else {
			console.log(defaults.name + ' - Error')
			console.error('Invalid response from server')
			cb()
		}
	})
}

function request(url, payload, cb) {
	isLogedIn(() => { needle.post(url, payload, { headers, cookies, rejectUnauthorized: false }, cb) })
}

function findChannel(query, chans) {
	const results = []
	chans.forEach(chan => {
		if (chan.name.toLowerCase().includes(query.toLowerCase()))
			results.push(chan)
	})
	return results
}

function findMeta(id) {
	const idParts = id.split('_')
	const catId = idParts[1]
	let meta
	channels[catId].some(chan => {
		if (chan.id == id) {
			meta = chan
			return true
		}
	})
	return meta
}

function getCatalog(args, cb, force) {
	let id
	if (config.style == 'Catalogs') {
		id = args.id.replace(defaults.prefix + 'cat_', '')
	} else if (config.style == 'Filters') {
		const genre = (args.extra || {}).genre
		if (genre)
			categories.some(el => {
				if (el.name == genre) {
					id = el.id
					return true
				}
			})
		if (!id) {
			console.log(defaults.name + ' - Could not get id for request')
			cb(false)
			return
		}
	} else if (config.style == 'Channels') {
		if (force) {
			id = args.id.replace(defaults.prefix + 'cat_', '')
		} else {
			cb(categories.map(catToMeta))
			return
		}
	}
	if (channels[id] && channels[id].length)
		cb(channels[id])
	else {
		console.log(defaults.name + ' - Missing id for request')
		cb(false)
	}
}

function addZero(deg) {
	return ('0' + deg).slice(-2)
}

function getCategories(cb) {
	needle.get(config.host + 'api/channels', { headers, cookies, rejectUnauthorized: false }, (err, resp, body) => {
		if (!err && body && body.status == 1) {
			channels = {}
			for (let key in body.body.channels) {
				const chan = body.body.channels[key]
				if (!channels[chan.category])
					channels[chan.category] = []
				const poster = 'https://www.unlim.tv/assets/img/channels/' + chan.logo
				channels[chan.category].push({ name: chan.name, id: defaults.prefix + chan.category + '_' + key, type: 'tv', logo: poster, poster, posterShape: 'landscape' })
			}
			genres = []
			for (let key in body.body.categories) {
				genres.push({ name: body.body.categories[key], id: key })
			}
			if (genres.length) {
				setCatalogs(genres)
				cb(true)
			} else
				cb(false)
		} else
			cb(false)
	})
}

function retrieveManifest() {
	function manifest() {
		return {
			id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
			version: '1.0.0',
			name: defaults.name,
			description: 'IPTV Service - Requires Subscription',
			resources: ['stream', 'meta', 'catalog'],
			types: ['tv', 'channel'],
			idPrefixes: [defaults.prefix],
			icon: defaults.icon,
			catalogs
		}
	}

	return new Promise((resolve, reject) => {
		isLogedIn(() => { resolve(manifest()) })
	})
}

async function retrieveRouter() {
	const manifest = await retrieveManifest()

	const { addonBuilder, getInterface, getRouter } = require('stremio-addon-sdk')

	const builder = new addonBuilder(manifest)

	builder.defineCatalogHandler(args => {
		return new Promise((resolve, reject) => {
			const extra = args.extra || {}
			if (config.style == 'Filters' && !extra.genre) {
				return resolve({ metas: [] })
			}
			getCatalog(args, catalog => {
				if (catalog) {
					let results = catalog
					if (extra.search)
						results = findChannel(extra.search, catalog)
					if (results.length)
						resolve({ metas: results })
					else
						reject(defaults.name + ' - No results for catalog request')
				} else
					reject(defaults.name + ' - Invalid catalog response')
			})
		})
	})

	builder.defineMetaHandler(args => {
		return new Promise((resolve, reject) => {
			if (config.style == 'Channels') {
				let meta
				categories.some(cat => {
					if (cat.id == args.id.replace(defaults.prefix + 'cat_', '')) {
						meta = catToMeta(cat)
						return true
					}
				})
				if (!meta) {
					reject(defaults.name + ' - Could not get meta')
					return
				}
				getCatalog(args, catalog => {
					if ((catalog || []).length)
						meta.videos = catalog.map(catToVideo)
					resolve({ meta })
				}, true)
			} else {
				const meta = findMeta(args.id)
				if (!meta) reject(defaults.name + ' - Could not get meta')
				else resolve({ meta })
			}
		})
	})

	builder.defineStreamHandler(args => {
		return new Promise((resolve, reject) => {
			const chanId = args.id.split('_')[2]
			needle.get(config.host + 'channels/get-stream/' + chanId, { headers, cookies, rejectUnauthorized: false }, (err, resp, body) => {
				if (!err && body && body.body)
					resolve({ streams: [ { title: 'Stream', url: body.body.split('\\/').join('/') } ] })
				else
					reject(defaults.name + ' - Could not get stream')
			})
		})
	})

	const addonInterface = getInterface(builder)

	return getRouter(addonInterface)

}

module.exports = retrieveRouter()
