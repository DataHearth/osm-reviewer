{{- define "osm-reviewer.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "osm-reviewer.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "osm-reviewer.labels" -}}
{{ include "osm-reviewer.selectorLabels" . }}
app.kubernetes.io/version: {{ include "osm-reviewer.imageTag" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "osm-reviewer.imageTag" -}}
{{- required "image.tag is required: the app release to run, e.g. 0.1.0" .Values.image.tag -}}
{{- end -}}

{{- define "osm-reviewer.origin" -}}
{{- required "origin is required: the URL reviewers open, e.g. https://osm-review.example.net" .Values.origin -}}
{{- end -}}

{{- define "osm-reviewer.host" -}}
{{- (urlParse (include "osm-reviewer.origin" .)).hostname -}}
{{- end -}}

{{- define "osm-reviewer.adminSecret" -}}
{{- .Values.admin.existingSecret | default (printf "%s-admin" (include "osm-reviewer.fullname" .)) -}}
{{- end -}}
