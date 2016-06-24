



/*
 * Env Vars
 */
var marathonHost = process.env.MARATHON_HOST;
var scalingInterval = process.env.SCALING_INTERVAL || 5;





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

	spikeFilterCount:    { default: 2,      parser: parseInt },

	scalePercent:        { default: 10,     parser: parseInt },
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
var spikeFilterCounts = {};
(function processCheck (previousState) {
	console.log('Process Check');
	getApps()
		.then(getAppDetails)
		.then(getMonitoring(previousState))
		.then(context => Promise.all(
			context.apps.map(app => {
				// get current instance count
				var currentInstanceCount = app.details.tasks.length;

				// process target values
				// the scaleDownFactor is here to prevent the yo-yo effect on the scaling mechanism
				// ex: thresholds are 20% to 30% CPU with 1 instance, when the CPU reaches 30% => scale up
				// now you have 2 instances, (1x30% + 1x0%)/2=20% => scale down
				var scaleDownFactor = currentInstanceCount === 1 ? 1 : (currentInstanceCount - 1)/currentInstanceCount;
				// cpu
				var minCpu = Math.min(scaleDownFactor * getConf(app, 'maxCpuPercent'), getConf(app, 'minCpuPercent'));
				var maxCpu = getConf(app, 'maxCpuPercent');
				// mem
				var minMem = Math.min(scaleDownFactor * getConf(app, 'maxMemPercent'), getConf(app, 'minMemPercent'));
				var maxMem = getConf(app, 'maxMemPercent');

				// process the targets based on CPU and mem
				// cpu
				var cpuInstanceMin = Math.ceil(currentInstanceCount * app.stats.cpu / maxCpu);
				var cpuInstanceMax = Math.floor(currentInstanceCount * app.stats.cpu / minCpu);
				var cpuInstance    = app.stats.cpu > maxCpu ? cpuInstanceMin : ( app.stats.cpu < minCpu ? cpuInstanceMax : currentInstanceCount);
				// mem
				var memInstanceMin = Math.ceil(currentInstanceCount * app.stats.mem / maxMem);
				var memInstanceMax = Math.floor(currentInstanceCount * app.stats.mem / minMem);
				var memInstance    = app.stats.mem > maxMem ? memInstanceMin : ( app.stats.mem < minMem ? memInstanceMax : currentInstanceCount);

				// process the scaling
				var maxScale = Math.ceil(currentInstanceCount * getConf(app, 'scalePercent') / 100);
				var scale = constraint(
					Math.max(cpuInstance - currentInstanceCount, memInstance - currentInstanceCount),
					-maxScale,
					maxScale
				);

				// process instances
				var targetInstanceCount = constraint(
					currentInstanceCount + scale,
					getConf(app, 'minInstances'),
					getConf(app, 'maxInstances')
				);

				// process spike filter
				var action = targetInstanceCount > currentInstanceCount ? 1 : (targetInstanceCount < currentInstanceCount ? -1 : 0);
				var spikeFilterCount = spikeFilterCounts[app.id] = spikeFilterCounts[app.id] || { lastAction: 0, count: 0 };
				if (action !== spikeFilterCount.lastAction) {
					spikeFilterCount.lastAction = action;
					spikeFilterCount.count = 0;
				}
				if (spikeFilterCount.count < getConf(app, 'spikeFilterCount')) {
					spikeFilterCount.count++;
					targetInstanceCount = currentInstanceCount;
				}

				// log
				console.log(`        [${app.id}] Cpu:   ${app.stats.cpu.toFixed()}% (scale: ${cpuInstance - currentInstanceCount}, min: ${minCpu.toFixed()}%, max: ${maxCpu.toFixed()}%)`);
				console.log(`        [${app.id}] Mem:   ${app.stats.mem.toFixed()}% (scale: ${memInstance - currentInstanceCount}, min: ${minMem.toFixed()}%, max: ${maxMem.toFixed()}%)`);
				console.log(`        [${app.id}] Scale: ${scale} (max: ${maxScale})`);
				console.log(`        [${app.id}] Tasks: ${currentInstanceCount} (target: ${targetInstanceCount})`);

				// apply state
				if (previousState && targetInstanceCount !== currentInstanceCount) {
					console.log(`        [${app.id}] Scalling app from ${currentInstanceCount} to ${targetInstanceCount}`);
					return scaleApp(app, targetInstanceCount);
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

function constraint (value, min, max) {
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
