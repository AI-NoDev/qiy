import { CanAccess } from "@refinedev/core";
import { Alert } from "antd";
import { useParams } from "react-router";
import { ResourceForm } from "../components/resource-form";
import { getResource } from "../resources";
export default function ResourceCreate() { const resource = getResource(useParams().resource); return resource ? <CanAccess resource={resource.name} action="create" fallback={<Alert type="error" message="You do not have permission to create this resource." />}><ResourceForm resource={resource} /></CanAccess> : <Alert type="error" message="Unknown resource" />; }
