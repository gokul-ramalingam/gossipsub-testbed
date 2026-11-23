{{/*
Name of the headless Service. Fixed: the peers look it up by name
(SRV_NAME), and the pod DNS names are <pod>.peers.<namespace>.svc.
*/}}
{{- define "testbed.serviceName" -}}
peers
{{- end }}

{{/*
SRV name that the peers look up: _p2p._tcp.<this name>. A full name, so that
the resolver does not try the search domains first.
*/}}
{{- define "testbed.srvName" -}}
{{ include "testbed.serviceName" . }}.{{ .Release.Namespace }}.svc.{{ .Values.clusterDomain }}
{{- end }}

{{/*
Labels that select the pods of this release. The Service selects all peers
with them; each StatefulSet adds its implementation.
*/}}
{{- define "testbed.selectorLabels" -}}
app.kubernetes.io/name: gossipsub-peer
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Labels of every object: the selector labels and the recommended Kubernetes
and Helm labels.
*/}}
{{- define "testbed.labels" -}}
{{ include "testbed.selectorLabels" . }}
app.kubernetes.io/part-of: gossipsub-testbed
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
