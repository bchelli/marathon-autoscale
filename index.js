



/*
 * Env Vars
 */
var marathonHost = process.env.MARATHON_HOST;
var scalingInterval = process.env.SCALING_INTERVAL || 30;
var errorHistoryLength = process.env.ERROR_HISTORY_LENGTH || 30;





/*
 * Vars
 */
var fetch = require('node-fetch');
var labels = {
	enabled:             { default: false,  parser: v => v === 'true' || v === '1' },

	maxMemPercent:       { default: 80,     parser: parseInt },
	minMemPercent:       { default: 50,     parser: parseInt },
	maxCpuPercent:       { default: 40,     parser: parseInt },
	minCpuPercent:       { default: 10,     parser: parseInt },

	weightError:         { default: 1,      parser: parseInt },
	weightErrorHistory:  { default: 4,      parser: parseInt },

	maxInstances:        { default: 30,     parser: parseInt },
	minInstances:        { default: 1,      parser: parseInt },
};




/*
 * Check parameters
 */
if (!marathonHost) {
	console.log('MARATHON_HOST env must specify the marathon hostname or IP to allow this service to start.');
	process.exit(1);
}



/*
 * Start scheduler
 */
var errors = {};
(function processCheck (previousState) {
	console.log('Process Check');
	getApps()
		.then(getAppDetails)
		.then(getMonitoring(previousState))
		.then(context => Promise.all(
			context.apps.map(app => {

				var targetCpuPercent = Math.max(getConf(app, 'minCpuPercent'), Math.min(getConf(app, 'maxCpuPercent'), app.stats.cpu));
				var targetMemPercent = Math.max(getConf(app, 'minMemPercent'), Math.min(getConf(app, 'maxMemPercent'), app.stats.mem));

				// push errors
				var errs = (errors[app.id] = errors[app.id] || []);

				// process error based on input metrics
				var error = Math.max(app.stats.cpu - targetCpuPercent, app.stats.mem - targetMemPercent);
				if (errs.length) {
					error = (getConf(app, 'weightError') * error + getConf(app, 'weightErrorHistory') * avg(errs)) / (getConf(app, 'weightError') + getConf(app, 'weightErrorHistory'));
				}
				error = Math.min(1, Math.max(-1, error));

				// process instances
				var currentInstance = app.details.tasks.length;
				var targetInstances = constraint(
					getConf(app, 'minInstances'),
					getConf(app, 'maxInstances'),
					Math.floor(currentInstance + error)
				);

				// apply state
				if (previousState) {
					console.log(`        [${app.id}] Cpu:   ${app.stats.cpu} (target: ${targetCpuPercent})`);
					console.log(`        [${app.id}] Mem:   ${app.stats.mem} (target: ${targetMemPercent})`);
					console.log(`        [${app.id}] Tasks: ${currentInstance} (target: ${targetInstances}, scale: ${targetInstances - currentInstance})`);
					console.log(`        [${app.id}] Err:   ${avg(errs)}`);

					errs.push(currentInstance - targetInstances);
					if (errs.length > errorHistoryLength) { errs.shift(); }
					if (targetInstances !== currentInstance) {
						console.log(`        [${app.id}] Scalling app from ${currentInstance} to ${targetInstances}`);
						return scaleApp(app, targetInstances);
					}
				}

				return Promise.resolve();
			})
		)
		.then(_ => context))
		.then(logSuccess(`    Process Check success`))
		.catch(logError(`    Process Check failed`))
		.then(delay(scalingInterval*1000, processCheck))
		.catch(delay(scalingInterval*1000, processCheck))
		;
})();




/*
 * API calls
 */
function getApps () {
	console.log('    Getting apps processing');
	return request(`${marathonHost}/v2/apps`)
		.then(response =>
			response.apps.filter(app => getConf(app, 'enabled'))
		)
		.then(logSuccess(`    Getting apps success`))
		.catch(logError(`    Getting apps failed`))
		;
}

function getOneAppDetail (app) {
	console.log(`        [${app.id}] Getting app details processing`);
	return request(`${marathonHost}/v2/apps${app.id}`)
		.then(response => response.app)
		.then(logSuccess(`        [${app.id}] Getting app details success`))
		.catch(logError(`        [${app.id}] Getting app details failed`))
		;
}

function getAppDetails (apps) {
	console.log('    Getting app details processing');
	return Promise.all(apps.map(getOneAppDetail))
		.then(details => apps.map((app, index) => Object.assign(
			{details: details[index]},
			app
		)))
		.then(logSuccess(`    Getting app details success`))
		.catch(logError(`    Getting app details failed`))
		;
}

function scaleApp (app, nbInstances) {
	console.log(`    [${app.id}] Scalling app to ${nbInstances}`);
	return request(`${marathonHost}/v2/apps${app.id}?force=true`, {
			method: 'put',
			headers: {
				'Content-type': 'application/json'
			},
			body: JSON.stringify({
				instances: nbInstances
			})
		})
		.then(logSuccess(`    [${app.id}] Scalling app to ${nbInstances} success`))
		.catch(logError(`    [${app.id}] Scalling app to ${nbInstances} failed`))
		;
}

function getExecutorStatistics (host) {
	console.log(`    Fetching stats from ${host}`);
	return request(`http://${host}:5051/monitor/statistics.json`)
		.then(response => response.reduce((executors, executor) => Object.assign(
			{[executor.executor_id]: executor},
			executors
		), {}))
		.then(logSuccess(`    Fetching stats from ${host} success`))
		.catch(logError(`    Fetching stats from ${host} failed`))
		;
}

function getMonitoring (previousState) {
	return apps => {
		console.log(`    Processing monitoring`);
		var hosts = {};
		apps.forEach(app => {
			app.details.tasks.forEach(task => {
				hosts[task.host] = true;
			});
		});
		return Promise.all(Object.keys(hosts).map(getExecutorStatistics))
			.then(executorsList => Object.assign.apply({}, executorsList))
			.then(executors => ({
				executors: executors,
				apps: apps.map(app => Object.assign(
					{
						stats: {
							cpu:  avg(app.details.tasks.map(task =>
								processCpu(executors[task.id], previousState && previousState.executors && previousState.executors[task.id])
							)),
							mem:  avg(app.details.tasks.map(task =>
								processMem(executors[task.id])
							)),
						}
					},
					app
				))
			}))
			.then(logSuccess(`    Processing monitoring success`))
			.catch(logError(`    Processing monitoring failed`))
			;
	};
}





/*
 * Helpers
 */
function processMem (task) {
	return (task || 0) && (100 * task.statistics.mem_rss_bytes / task.statistics.mem_limit_bytes)
}

function processCpu (task, previousTask) {
	return (task && previousTask || 0) && 100 * (getCpu(task) - getCpu(previousTask)) / scalingInterval;
}

function getCpu (task) {
	return (task.statistics.cpus_system_time_secs + task.statistics.cpus_user_time_secs);
}

function avg (arr) {
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function request (url, options) {
	return fetch(url, Object.assign({
			timeout: 2000
		}, options))
		.then(response => {
			var body = response.json();
			if (response.status >= 200 && response.status < 300) {
				return body;
			} else {
				return body.then(error => {
					throw error;
				});
			}
		})
		;
}

function constraint (min, max, value) {
	return Math.max(min, Math.min(max, value));
}

function delay (timer, action) {
	return value => new Promise (function (resolve, reject) {
		setTimeout(function () {
			action(value);
			resolve(value);
		}, timer);
	});
}

function logSuccess (text) {
	return data => {
		console.log(text);
		return data;
	};
}

function logError (text) {
	return error => {
		console.error(`${text}: ${JSON.stringify(error)}`);
		if (error.stack) {
			console.error(error.stack);
		} 
		throw error;
	};
}

function getConf (app, label) {
	var processor = labels[label];
	return processor.parser(app.labels[`marathon-autoscale.${label}`]) || processor.default;
}

