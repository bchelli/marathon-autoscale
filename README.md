
# Marathon Autoscale

## Current version 0.1.6

## Installation

### From source
Require:
* node
* npm

Run:
```shell
# installation
npm install
# run
MARATHON_HOST=http://XX.XX.XX.XX:8080 npm run start
```

### From docker
```shell
docker run -e "MARATHON_HOST=http://XX.XX.XX.XX:8080" -t bchelli/marathon-autoscale:0.1.6
```

### From marathon
```json
{
  "id": "/marathon-autoscale",

  "cpus": 0.5,
  "mem": 128,
  "disk": 0,

  "instances": 1,

  "container": {
    "type": "DOCKER",
    "docker": {
      "image": "bchelli/marathon-autoscale:0.1.6",
      "network": "BRIDGE"
    }
  },

  "env": {
    "MARATHON_HOST": "http://XX.XX.XX.XX:8080"
  },

  "healthChecks": [
    {
      "protocol": "COMMAND",
      "command": {
        "value": "/bin/ls"
      },
      "gracePeriodSeconds": 300,
      "intervalSeconds": 60,
      "timeoutSeconds": 20,
      "maxConsecutiveFailures": 3,
      "ignoreHttp1xx": false
    }
  ]
}
```

## Usage

Marathon Autoscale relies on labels. Just put the following labels to configure the autoscaling mechanism:
* ```marathon-autoscale.enabled``` (boolean, default: false): Enable/disable the autoscaling for this service.
* ```marathon-autoscale.maxMemPercent``` (integer, default: 80): Maximum allowed CPU usage => trigger up scaling.
* ```marathon-autoscale.minMemPercent``` (integer, default: 50): Minimum allowed CPU usage => trigger down scaling.
* ```marathon-autoscale.maxCpuPercent``` (integer, default: 40): Maximum allowed memory usage => trigger up scaling.
* ```marathon-autoscale.minCpuPercent``` (integer, default: 10): Minimum allowed memory usage => trigger down scaling.
* ```marathon-autoscale.maxInstances``` (integer, default: 30): Maximum number of instance for the service.
* ```marathon-autoscale.minInstances``` (integer, default: 1): Minimum number of instance for the service.

Environment variables:
* ```MARATHON_HOST``` (mandatory): Marathon URL, must be http://XX.XX.XX.XX:8080
* ```SCALING_INTERVAL``` (optional, in seconds, default: 5): number of seconds between 2 processing of the instances scaling.

