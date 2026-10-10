<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:3f6e02b4-e533-4c1d-b886-8a1dc89c9489(qiy.erpworkflow)">
  <persistence version="9" />
  <languages><use id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy" version="0" /></languages>
  <imports />
  <registry>
    <language id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy">
      <concept id="720000000000000001" name="qiy.structure.Application" flags="ng" index="qa">
        <property id="720000000000000104" name="apiClient" index="qapiClient" />
        <child id="72000000000000101" name="database" index="qd" />
        <child id="72000000000000102" name="entities" index="qe" />
        <child id="72000000000000103" name="relations" index="qrelations" />
        <child id="72000000000000105" name="elysia" index="qelysia" />
        <child id="72000000000000106" name="storage" index="qstorage" />
        <child id="72000000000000107" name="auth" index="qauth" />
        <child id="72000000000000108" name="scopes" index="qscopes" />
        <child id="72000000000000109" name="menuGroups" index="qmenuGroups" />
        <child id="72000000000000110" name="dashboardMetrics" index="qdashboards" />
        <child id="72000000000000111" name="enums" index="qenums" />
        <child id="72000000000000112" name="workflows" index="qworkflows" />
      </concept>
      <concept id="720000000000000023" name="qiy.structure.WorkflowConfig" flags="nn" index="qworkflowConfig" />
      <concept id="720000000000000016" name="qiy.structure.AuthConfig" flags="nn" index="qauthConfig">
        <property id="720000000000001601" name="provider" index="qauthProvider" />
        <property id="720000000000001602" name="userEntity" index="qauthUser" />
        <property id="720000000000001603" name="subjectField" index="qauthSubject" />
        <property id="720000000000001604" name="roleField" index="qauthRole" />
      </concept>
      <concept id="720000000000000017" name="qiy.structure.ScopeConfig" flags="nn" index="qscopeConfig">
        <property id="720000000000001701" name="resource" index="qscopeResource" />
        <property id="720000000000001702" name="field" index="qscopeField" />
        <property id="720000000000001703" name="claim" index="qscopeClaim" />
      </concept>
      <concept id="720000000000000018" name="qiy.structure.MenuGroup" flags="nn" index="qmenuGroup">
        <property id="720000000000001801" name="label" index="qmenuLabel" />
        <property id="720000000000001802" name="icon" index="qmenuIcon" />
        <property id="720000000000001803" name="parent" index="qmenuParent" />
        <child id="72000000000001801" name="resources" index="qmenuResources" />
      </concept>
      <concept id="720000000000000019" name="qiy.structure.MenuResource" flags="nn" index="qmenuResource">
        <property id="720000000000001901" name="resource" index="qmenuResourceName" />
      </concept>
      <concept id="720000000000000020" name="qiy.structure.DashboardMetric" flags="nn" index="qdashboardMetric">
        <property id="720000000000002001" name="resource" index="qmetricResource" />
        <property id="720000000000002002" name="label" index="qmetricLabel" />
        <property id="720000000000002003" name="icon" index="qmetricIcon" />
        <property id="720000000000002004" name="span" index="qmetricSpan" />
        <property id="720000000000002005" name="type" index="qmetricType" />
        <property id="720000000000002006" name="groupBy" index="qmetricGroupBy" />
        <property id="720000000000002007" name="days" index="qmetricDays" />
      </concept>
      <concept id="720000000000000021" name="qiy.structure.Enum" flags="nn" index="qenum">
        <child id="72000000000002101" name="values" index="qenumValues" />
      </concept>
      <concept id="720000000000000022" name="qiy.structure.EnumValue" flags="nn" index="qenumValue">
        <property id="720000000000002201" name="label" index="qenumLabel" />
        <property id="720000000000002202" name="color" index="qenumColor" />
        <property id="720000000000002203" name="icon" index="qenumIcon" />
      </concept>
      <concept id="720000000000000015" name="qiy.structure.StorageConfig" flags="nn" index="qstorageConfig">
        <property id="720000000000001501" name="provider" index="qstorageProvider" />
      </concept>
      <concept id="720000000000000012" name="qiy.structure.ElysiaConfig" flags="nn" index="qelysiaConfig">
        <property id="720000000000001201" name="bearer" index="qbearer" />
        <property id="720000000000001202" name="serverTiming" index="qserverTiming" />
        <property id="720000000000001203" name="graphqlAdapter" index="qgraphqlAdapter" />
        <property id="720000000000001204" name="jwt" index="qjwt" />
        <property id="720000000000001205" name="static" index="qstatic" />
        <property id="720000000000001206" name="html" index="qhtml" />
        <property id="720000000000001207" name="drizzle" index="qdrizzle" />
        <child id="72000000000001203" name="cron" index="qcron" />
      </concept>
      <concept id="720000000000000013" name="qiy.structure.CronConfig" flags="nn" index="qcronConfig">
        <child id="72000000000001301" name="jobs" index="qjobs" />
      </concept>
      <concept id="720000000000000014" name="qiy.structure.CronJob" flags="nn" index="qcronJob">
        <property id="720000000000001401" name="pattern" index="qpattern" />
        <property id="720000000000001402" name="task" index="qtask" />
      </concept>
      <concept id="720000000000000002" name="qiy.structure.DatabaseConfig" flags="nn" index="qf">
        <property id="720000000000000201" name="dialect" index="qg" />
        <property id="720000000000000202" name="orm" index="qh" />
      </concept>
      <concept id="720000000000000005" name="qiy.structure.Entity" flags="nn" index="qk">
        <property id="720000000000000501" name="tableName" index="ql" />
        <child id="72000000000000501" name="fields" index="qo" />
        <child id="72000000000000502" name="indexes" index="qindexes" />
      </concept>
      <concept id="720000000000000006" name="qiy.structure.Field" flags="nn" index="qp">
        <property id="720000000000000601" name="type" index="qq" />
        <property id="720000000000000602" name="columnName" index="qr" />
        <property id="720000000000000603" name="nullable" index="qs" />
        <property id="720000000000000604" name="primaryKey" index="qt" />
        <property id="720000000000000605" name="unique" index="qu" />
        <property id="720000000000000612" name="precision" index="qprecision" />
        <property id="720000000000000613" name="scale" index="qscale" />
        <property id="720000000000000614" name="visible" index="qvisible" />
        <property id="720000000000000615" name="listVisible" index="qlistVisible" />
        <property id="720000000000000616" name="formVisible" index="qformVisible" />
        <property id="720000000000000617" name="showVisible" index="qshowVisible" />
        <property id="720000000000000618" name="sortable" index="qsortable" />
        <property id="720000000000000619" name="filterable" index="qfilterable" />
        <property id="720000000000000620" name="label" index="qfieldLabel" />
        <property id="720000000000000621" name="icon" index="qfieldIcon" />
      </concept>
      <concept id="720000000000000007" name="qiy.structure.Index" flags="nn" index="qindex">
        <property id="720000000000000701" name="method" index="qmethod" />
        <property id="720000000000000702" name="unique" index="qunique" />
        <property id="720000000000000704" name="concurrently" index="qconcurrently" />
        <child id="72000000000000701" name="columns" index="qcolumns" />
      </concept>
      <concept id="720000000000000008" name="qiy.structure.IndexColumn" flags="nn" index="qcolumn">
        <property id="720000000000000801" name="fieldName" index="qfield" />
      </concept>
      <concept id="720000000000000011" name="qiy.structure.Relation" flags="nn" index="qrelation">
        <property id="720000000000001101" name="fromEntity" index="qfromEntity" />
        <property id="720000000000001102" name="fromField" index="qfromField" />
        <property id="720000000000001103" name="toEntity" index="qtoEntity" />
        <property id="720000000000001104" name="toField" index="qtoField" />
        <property id="720000000000001105" name="cardinality" index="qcardinality" />
        <property id="720000000000001106" name="onDelete" index="qonDelete" />
      </concept>
    </language>
    <language id="ceab5195-25ea-4f22-9b92-103b95ca8c0c" name="jetbrains.mps.lang.core">
      <concept id="1169194658468" name="jetbrains.mps.lang.core.structure.INamedConcept" flags="ngI" index="TrEIO">
        <property id="1169194664001" name="name" index="TrG5h" />
      </concept>
    </language>
  </registry>
  <node concept="qa" id="130000000000051"><property role="TrG5h" value="qiy-erp-workflow" /><node concept="qf" id="130000000000011" role="qd"><property role="TrG5h" value="main" /><property role="qg" value="postgresql" /><property role="qh" value="drizzle" /></node><node concept="qworkflowConfig" id="130000000000012" role="qworkflows"><property role="TrG5h" value="orderInventory" /></node><node concept="qenum" id="130000000000006" role="qenums"><property role="TrG5h" value="orderStatus" /><node concept="qenumValue" id="130000000000001" role="qenumValues"><property role="TrG5h" value="draft" /><property role="qenumLabel" value="草稿" /><property role="qenumColor" value="default" /><property role="qenumIcon" value="EditOutlined" /></node><node concept="qenumValue" id="130000000000002" role="qenumValues"><property role="TrG5h" value="submitted" /><property role="qenumLabel" value="已提交" /><property role="qenumColor" value="blue" /><property role="qenumIcon" value="SendOutlined" /></node><node concept="qenumValue" id="130000000000003" role="qenumValues"><property role="TrG5h" value="approved" /><property role="qenumLabel" value="已审批" /><property role="qenumColor" value="green" /><property role="qenumIcon" value="CheckOutlined" /></node><node concept="qenumValue" id="130000000000004" role="qenumValues"><property role="TrG5h" value="shipped" /><property role="qenumLabel" value="已出库" /><property role="qenumColor" value="cyan" /><property role="qenumIcon" value="SendOutlined" /></node><node concept="qenumValue" id="130000000000005" role="qenumValues"><property role="TrG5h" value="cancelled" /><property role="qenumLabel" value="已取消" /><property role="qenumColor" value="red" /><property role="qenumIcon" value="CloseOutlined" /></node></node><node concept="qenum" id="130000000000010" role="qenums"><property role="TrG5h" value="userRole" /><node concept="qenumValue" id="130000000000007" role="qenumValues"><property role="TrG5h" value="admin" /><property role="qenumLabel" value="管理员" /><property role="qenumColor" value="red" /><property role="qenumIcon" value="SafetyOutlined" /></node><node concept="qenumValue" id="130000000000008" role="qenumValues"><property role="TrG5h" value="operator" /><property role="qenumLabel" value="运营" /><property role="qenumColor" value="blue" /><property role="qenumIcon" value="UserOutlined" /></node><node concept="qenumValue" id="130000000000009" role="qenumValues"><property role="TrG5h" value="viewer" /><property role="qenumLabel" value="只读" /><property role="qenumColor" value="default" /><property role="qenumIcon" value="EyeOutlined" /></node></node><node concept="qauthConfig" id="130000000000013" role="qauth"><property role="qauthProvider" value="oidc" /><property role="qauthUser" value="users" /><property role="qauthSubject" value="externalSubject" /><property role="qauthRole" value="role" /></node><node concept="qk" id="130000000000030" role="qe"><property role="TrG5h" value="users" /><property role="ql" value="users" /><node concept="qp" id="130000000000025" role="qo"><property role="TrG5h" value="id" /><property role="qq" value="UUID" /><property role="qt" value="true" /></node><node concept="qp" id="130000000000026" role="qo"><property role="TrG5h" value="email" /><property role="qq" value="Text" /><property role="qu" value="true" /></node><node concept="qp" id="130000000000027" role="qo"><property role="TrG5h" value="displayName" /><property role="qq" value="Text" /></node><node concept="qp" id="130000000000028" role="qo"><property role="TrG5h" value="externalSubject" /><property role="qq" value="Text" /><property role="qu" value="true" /><property role="qlistVisible" value="false" /><property role="qshowVisible" value="false" /></node><node concept="qp" id="130000000000029" role="qo"><property role="TrG5h" value="role" /><property role="qq" value="userRole" /></node></node><node concept="qk" id="130000000000037" role="qe"><property role="TrG5h" value="orders" /><property role="ql" value="orders" /><node concept="qp" id="130000000000031" role="qo"><property role="TrG5h" value="id" /><property role="qq" value="UUID" /><property role="qt" value="true" /></node><node concept="qp" id="130000000000032" role="qo"><property role="TrG5h" value="orderNumber" /><property role="qq" value="Text" /><property role="qu" value="true" /></node><node concept="qp" id="130000000000033" role="qo"><property role="TrG5h" value="status" /><property role="qq" value="orderStatus" /><property role="qlistVisible" value="false" /><property role="qsortable" value="false" /><property role="qfilterable" value="true" /><property role="qfieldLabel" value="订单状态" /><property role="qfieldIcon" value="TagsOutlined" /></node><node concept="qp" id="130000000000034" role="qo"><property role="TrG5h" value="totalAmount" /><property role="qq" value="Money" /><property role="qprecision" value="12" /><property role="qscale" value="2" /></node><node concept="qp" id="130000000000035" role="qo"><property role="TrG5h" value="approvedBy" /><property role="qq" value="UUID" /><property role="qs" value="true" /><property role="qlistVisible" value="false" /><property role="qformVisible" value="false" /><property role="qfilterable" value="false" /></node><node concept="qp" id="130000000000036" role="qo"><property role="TrG5h" value="createdAt" /><property role="qq" value="DateTime" /></node></node><node concept="qk" id="130000000000043" role="qe"><property role="TrG5h" value="orderItems" /><property role="ql" value="order_items" /><node concept="qp" id="130000000000038" role="qo"><property role="TrG5h" value="id" /><property role="qq" value="UUID" /><property role="qt" value="true" /></node><node concept="qp" id="130000000000039" role="qo"><property role="TrG5h" value="orderId" /><property role="qq" value="UUID" /></node><node concept="qp" id="130000000000040" role="qo"><property role="TrG5h" value="productId" /><property role="qq" value="UUID" /></node><node concept="qp" id="130000000000041" role="qo"><property role="TrG5h" value="quantity" /><property role="qq" value="Integer" /></node><node concept="qp" id="130000000000042" role="qo"><property role="TrG5h" value="unitPrice" /><property role="qq" value="Money" /><property role="qprecision" value="12" /><property role="qscale" value="2" /></node></node><node concept="qk" id="130000000000048" role="qe"><property role="TrG5h" value="inventoryItems" /><property role="ql" value="inventory_items" /><node concept="qp" id="130000000000044" role="qo"><property role="TrG5h" value="id" /><property role="qq" value="UUID" /><property role="qt" value="true" /></node><node concept="qp" id="130000000000045" role="qo"><property role="TrG5h" value="productId" /><property role="qq" value="UUID" /></node><node concept="qp" id="130000000000046" role="qo"><property role="TrG5h" value="quantity" /><property role="qq" value="Integer" /></node><node concept="qp" id="130000000000047" role="qo"><property role="TrG5h" value="reservedQuantity" /><property role="qq" value="Integer" /></node></node><node concept="qrelation" id="130000000000049" role="qrelations"><property role="TrG5h" value="orderItemOrder" /><property role="qfromEntity" value="orderItems" /><property role="qfromField" value="orderId" /><property role="qtoEntity" value="orders" /><property role="qtoField" value="id" /><property role="qcardinality" value="one" /></node><node concept="qrelation" id="130000000000050" role="qrelations"><property role="TrG5h" value="orderApprovedBy" /><property role="qfromEntity" value="orders" /><property role="qfromField" value="approvedBy" /><property role="qtoEntity" value="users" /><property role="qtoField" value="id" /><property role="qcardinality" value="one" /><property role="qonDelete" value="setNull" /></node><node concept="qmenuGroup" id="130000000000014" role="qmenuGroups"><property role="TrG5h" value="operations" /><property role="qmenuLabel" value="业务运营" /><property role="qmenuIcon" value="ShopOutlined" /></node><node concept="qmenuGroup" id="130000000000017" role="qmenuGroups"><property role="TrG5h" value="sales" /><property role="qmenuLabel" value="销售管理" /><property role="qmenuIcon" value="ShoppingOutlined" /><property role="qmenuParent" value="operations" /><node concept="qmenuResource" id="130000000000015" role="qmenuResources"><property role="qmenuResourceName" value="orders" /></node><node concept="qmenuResource" id="130000000000016" role="qmenuResources"><property role="qmenuResourceName" value="order_items" /></node></node><node concept="qmenuGroup" id="130000000000019" role="qmenuGroups"><property role="TrG5h" value="inventory" /><property role="qmenuLabel" value="库存管理" /><property role="qmenuIcon" value="InboxOutlined" /><property role="qmenuParent" value="operations" /><node concept="qmenuResource" id="130000000000018" role="qmenuResources"><property role="qmenuResourceName" value="inventory_items" /></node></node><node concept="qmenuGroup" id="130000000000021" role="qmenuGroups"><property role="TrG5h" value="administration" /><property role="qmenuLabel" value="系统管理" /><property role="qmenuIcon" value="SettingOutlined" /><node concept="qmenuResource" id="130000000000020" role="qmenuResources"><property role="qmenuResourceName" value="users" /></node></node><node concept="qdashboardMetric" id="130000000000022" role="qdashboards"><property role="TrG5h" value="orderCount" /><property role="qmetricResource" value="orders" /><property role="qmetricLabel" value="订单总数" /><property role="qmetricIcon" value="ShoppingOutlined" /><property role="qmetricSpan" value="8" /></node><node concept="qdashboardMetric" id="130000000000023" role="qdashboards"><property role="TrG5h" value="orderStatus" /><property role="qmetricResource" value="orders" /><property role="qmetricLabel" value="订单状态分布" /><property role="qmetricSpan" value="12" /><property role="qmetricType" value="distribution" /><property role="qmetricGroupBy" value="status" /></node><node concept="qdashboardMetric" id="130000000000024" role="qdashboards"><property role="TrG5h" value="orderTrend" /><property role="qmetricResource" value="orders" /><property role="qmetricLabel" value="近 30 天订单趋势" /><property role="qmetricSpan" value="24" /><property role="qmetricType" value="trend" /><property role="qmetricGroupBy" value="createdAt" /><property role="qmetricDays" value="30" /></node></node>
</model>
