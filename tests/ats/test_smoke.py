"""app-test-suite smoke for the pro chart.

app-test-suite 1.x (the generated execute-chart-tests CircleCI job) creates a kind
cluster, applies its bundled CRDs, installs the packaged chart with
`helm upgrade --install --wait` (namespace and values file: .ats/main.yaml) and then
runs `pytest -m smoke` in this directory. The smoke proves that the chart installs on a
bare cluster and that its Deployments come up with all replicas ready.
"""

import logging
import os
from typing import List

import pykube
import pytest
from pytest_helm_charts.clusters import Cluster
from pytest_helm_charts.k8s.deployment import wait_for_deployments_to_run

logger = logging.getLogger(__name__)

# app-test-suite exports the release namespace (app-tests-deploy-namespace in .ats/main.yaml).
namespace = os.environ.get("ATS_RELEASE_NAMESPACE", "pro")
deployments = ["pro"]
timeout = 120


@pytest.mark.smoke
def test_api_working(kube_cluster: Cluster) -> None:
    """The test cluster is reachable."""
    assert kube_cluster.kube_client is not None
    assert len(pykube.Node.objects(kube_cluster.kube_client)) >= 1


@pytest.mark.smoke
@pytest.mark.flaky(reruns=1, reruns_delay=15)
def test_deployments_ready(kube_cluster: Cluster) -> None:
    """Every Deployment of the release runs with all its replicas ready."""
    ready: List[pykube.Deployment] = wait_for_deployments_to_run(
        kube_cluster.kube_client, deployments, namespace, timeout
    )
    assert len(ready) == len(deployments)
    for d in ready:
        wanted = int(d.obj["spec"]["replicas"])
        got = int(d.obj["status"].get("readyReplicas", 0))
        assert got == wanted, f"{namespace}/{d.name}: {got}/{wanted} replicas ready"
        logger.info("Deployment %s/%s ready (%d replicas)", namespace, d.name, got)
