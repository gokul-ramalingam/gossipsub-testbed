{{/*
Name of the headless Service. Fixed, because the SRV name includes it.
*/}}
{{- define "gossipsub-testbed.serviceName" -}}
peers
{{- end }}

{{/*
Full DNS name of the Service, for the SRV lookup _p2p._tcp.<name>.
*/}}
{{- define "gossipsub-testbed.srvName" -}}
{{ include "gossipsub-testbed.serviceName" . }}.{{ .Release.Namespace }}.svc.{{ .Values.clusterDomain }}
{{- end }}

{{/*
Labels that select all peers of the release.
*/}}
{{- define "gossipsub-testbed.selectorLabels" -}}
app.kubernetes.io/name: gossipsub-peer
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Labels of every object.
*/}}
{{- define "gossipsub-testbed.labels" -}}
{{ include "gossipsub-testbed.selectorLabels" . }}
app.kubernetes.io/part-of: gossipsub-testbed
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}
