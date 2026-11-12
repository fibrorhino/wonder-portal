// A real CDC WONDER response, captured 2026-11-11 from
// https://wonder.cdc.gov/controller/datarequest/D158 for the query
//   group by year, injury intent = suicide, all four measures.
//
// TRIMMED, NOT EDITED. The variable lists, option menus and documentation
// blocks are removed (they are 110 KB the parser never reads), and only five
// of the dataset's 36 caveat DEFINITIONS are kept. Every line that remains is
// byte-for-byte what CDC sent. Do not tidy it: the point of the file is that
// it is CDC's shape rather than ours, CDATA wrappers and stray whitespace
// included.

export const D158_RESPONSE_XML = `<?xml version="1.0"?>
<page>
<platform>prod</platform>
<title>Underlying Cause of Death, 2018-2024, Single Race Results Form</title>
<default-map/>
<agreement-signed>true</agreement-signed>
<dataset code="D158" label="Underlying Cause of Death, 2018-2024, Single Race" family="UCD" validatorFamily="MORT" totals="true" vintage="2024" suppress-counts="true" suppress-zeros="true" agreement-required="true">
	<caveat code="D158.C00">
		<text evaluate="false"><![CDATA[Totals and Percent of Total are disabled when data are grouped by a 113 or 130 Cause List 
				because both aggregate and detailed values are displayed in the table. Also be aware that charts and maps 
				containing both aggregate and detail data could be misleading.]]></text>
		<rule>wonder:mcd-totals-disable()</rule>
	</caveat>
	<caveat code="D158.C00a">
		<text evaluate="false"><![CDATA[When you group results by 15 Leading Causes, results show the top 15 rankable causes for the 
				query criteria. Rankable causes are a subset of the ICD 113 and ICD 130 (Infants) Cause Lists. #Top15#]]></text>
		<rule>wonder:mort-leading()</rule>
	</caveat>
	<caveat xmlns:wonder="http://wonder.cdc.gov" xmlns:xalan="http://xml.apache.org/xalan" code="D158.C01">
		<text evaluate="true">concat("These items in the results table are not fully selected: ", wonder:partial-hier-labels(), ". 
				The Query Description lists the actual values selected.")</text>
		<rule>wonder:partial-hier()</rule>
	</caveat>
	<caveat code="D158.C10">
		<text evaluate="false"><![CDATA[Deaths and population estimates are shown separately from the adjacent counties for Carson City, 
				Nevada (FIPS code 32510).]]></text>
		<rule>wonder:cmf-5()</rule>
	</caveat>
	<caveat xmlns:wonder="http://wonder.cdc.gov" xmlns:xalan="http://xml.apache.org/xalan" code="D158.C23">
		<text evaluate="true">concat("The method used to calculate age-adjusted rates is documented here: ", wonder:cmf-aar-help())</text>
		<rule>wonder:cmf-aar('both')</rule>
	</caveat>
</dataset>
<response>
<request query-date="Nov 11, 2026 10:06:19 PM">
<variable-selections>
	<variable code="D158.V22" from-finder="false">
		<value code="2"/>
	</variable>
</variable-selections>
<byvariables>
	<variable code="D158.V1-level1"/>
</byvariables>
<list-variables>
</list-variables>
<other-parameters>
	<parameter code="O_show_totals" label="Show Totals" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>true</value>
	</parameter>
	<parameter code="O_show_zeros" label="Show Zero Values" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>true</value>
	</parameter>
	<parameter code="O_show_suppressed" label="Show Suppressed" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>true</value>
	</parameter>
	<parameter code="O_precision" label="Precision" display="false">
		<option value="0" label="0"/>
		<option value="1" label="1"/>
		<option value="2" label="2"/>
		<option value="3" label="3"/>
		<option value="4" label="4"/>
		<option value="5" label="5"/>
		<option value="6" label="6"/>
		<option value="7" label="7"/>
		<option value="8" label="8"/>
		<option value="9" label="9"/>
		<value>3</value>
	</parameter>
	<parameter code="O_timeout" label="Data Access Timeout" display="false">
		<option value="60" label="1"/>
		<option value="120" label="2"/>
		<option value="180" label="3"/>
		<option value="240" label="4"/>
		<option value="300" label="5"/>
		<option value="360" label="6"/>
		<option value="420" label="7"/>
		<option value="480" label="8"/>
		<option value="540" label="9"/>
		<option value="600" label="10"/>
		<option value="660" label="11"/>
		<option value="720" label="12"/>
		<option value="780" label="13"/>
		<option value="840" label="14"/>
		<option value="900" label="15"/>
		<value>600</value>
	</parameter>
	<parameter code="O_groups_count" label="Groups" display="false">
		<option value="2" label="Two"/>
		<option value="3" label="Three"/>
		<option value="4" label="Four"/>
		<option value="5" label="Five"/>
		<option value="6" label="Six"/>
		<option value="7" label="Seven"/>
		<option value="8" label="Eight"/>
		<option value="9" label="Nine"/>
		<option value="10" label="Ten"/>
		<value>4</value>
	</parameter>
	<parameter code="O_groups_methods" label="Group Breaks Method" display="false">
		<option value="QUANTILE" label="Quantile"/>
		<option value="EQUAL" label="Equal Interval"/>
		<value>QUANTILE</value>
	</parameter>
	<parameter code="O_aar_pop" label="Standard Population" display="true">
		<option value="0000" label="2000 U.S. Std. Population"/>
		<option value="1940" label="1940 U.S. Std. Million"/>
		<option value="1970" label="1970 U.S. Std. Million"/>
		<option value="2000" label="2000 U.S. Std. Million"/>
		<option value="1111" label="World Std. Million (WHO 2000-2025)"/>
		<option value="2222" label="World Std. Million (SEGI 1960)"/>
		<value>0000</value>
	</parameter>
	<parameter code="O_age" label="" display="false">
		<value>D158.V5</value>
	</parameter>
	<parameter code="O_rate_per" label="Calculate Rates Per" display="true">
		<option value="1000" label="1,000"/>
		<option value="10000" label="10,000"/>
		<option value="100000" label="100,000"/>
		<option value="1000000" label="1,000,000"/>
		<value>100000</value>
	</parameter>
	<parameter code="O_post_pops" label="Rate Options" display="true">
		<option value="false" label="Default intercensal populations for years 2001-2009 (except Infant Age Groups)"/>
		<option value="true" label="Archive postcensal populations for years 2001-2009 (except Infant Age Groups)"/>
		<value>false</value>
	</parameter>
	<parameter code="O_icd_selections" label="" display="false">
		<value>D158.V22,</value>
	</parameter>
	<parameter code="O_ucd" display="false">
		<value>D158.V22</value>
	</parameter>
	<parameter code="O_dates" display="false">
		<value>YEAR</value>
	</parameter>
	<parameter code="O_V1_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_aar" display="false">
		<value>aar_std</value>
	</parameter>
	<parameter code="O_javascript" display="false">
		<value>on</value>
	</parameter>
	<parameter code="O_V10_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_oc-sect1-request" display="false">
		<value>close</value>
	</parameter>
	<parameter code="O_urban" display="false">
		<value>D158.V19</value>
	</parameter>
	<parameter code="O_V2_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_title" display="false">
		<value></value>
	</parameter>
	<parameter code="O_V9_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V27_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_location" display="false">
		<value>D158.V9</value>
	</parameter>
	<parameter code="O_race" display="false">
		<value>D158.V42</value>
	</parameter>
	<parameter code="O_labels_opt" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_show_rank" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_groups" display="false">
		<value>false</value>
	</parameter>
</other-parameters>
<request-parameters>
	<parameter>
		<name>B_1</name>
		<value>D158.V1-level1</value>
	</parameter>
	<parameter>
		<name>B_2</name>
		<value>*None*</value>
	</parameter>
	<parameter>
		<name>B_3</name>
		<value>*None*</value>
	</parameter>
	<parameter>
		<name>B_4</name>
		<value>*None*</value>
	</parameter>
	<parameter>
		<name>B_5</name>
		<value>*None*</value>
	</parameter>
	<parameter>
		<name>M_1</name>
		<value>D158.M1</value>
	</parameter>
	<parameter>
		<name>M_2</name>
		<value>D158.M2</value>
	</parameter>
	<parameter>
		<name>M_3</name>
		<value>D158.M3</value>
	</parameter>
	<parameter>
		<name>M_4</name>
		<value>D158.M4</value>
	</parameter>
	<parameter>
		<name>VM_D158.M6_D158.V10</name>
		<value></value>
	</parameter>
	<parameter>
		<name>VM_D158.M6_D158.V17</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>VM_D158.M6_D158.V1_S</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>VM_D158.M6_D158.V42</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>VM_D158.M6_D158.V7</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V1</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D158.V10</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D158.V11</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V12</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V17</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V18</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V19</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V2</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D158.V20</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V21</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V22</name>
		<value>2</value>
	</parameter>
	<parameter>
		<name>V_D158.V23</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V24</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V27</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D158.V28</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V4</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V42</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V43</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V44</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V45</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V5</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V51</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V52</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V6</name>
		<value>00</value>
	</parameter>
	<parameter>
		<name>V_D158.V7</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D158.V9</name>
		<value></value>
	</parameter>
</request-parameters>
</request>
<other-parameters>
	<parameter code="O_show_totals" label="Show Totals" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>true</value>
	</parameter>
	<parameter code="O_show_zeros" label="Show Zero Values" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>true</value>
	</parameter>
	<parameter code="O_show_suppressed" label="Show Suppressed" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>true</value>
	</parameter>
	<parameter code="O_precision" label="Precision" display="false">
		<option value="0" label="0"/>
		<option value="1" label="1"/>
		<option value="2" label="2"/>
		<option value="3" label="3"/>
		<option value="4" label="4"/>
		<option value="5" label="5"/>
		<option value="6" label="6"/>
		<option value="7" label="7"/>
		<option value="8" label="8"/>
		<option value="9" label="9"/>
		<value>3</value>
	</parameter>
	<parameter code="O_timeout" label="Data Access Timeout" display="false">
		<option value="60" label="1"/>
		<option value="120" label="2"/>
		<option value="180" label="3"/>
		<option value="240" label="4"/>
		<option value="300" label="5"/>
		<option value="360" label="6"/>
		<option value="420" label="7"/>
		<option value="480" label="8"/>
		<option value="540" label="9"/>
		<option value="600" label="10"/>
		<option value="660" label="11"/>
		<option value="720" label="12"/>
		<option value="780" label="13"/>
		<option value="840" label="14"/>
		<option value="900" label="15"/>
		<value>600</value>
	</parameter>
	<parameter code="O_groups_count" label="Groups" display="false">
		<option value="2" label="Two"/>
		<option value="3" label="Three"/>
		<option value="4" label="Four"/>
		<option value="5" label="Five"/>
		<option value="6" label="Six"/>
		<option value="7" label="Seven"/>
		<option value="8" label="Eight"/>
		<option value="9" label="Nine"/>
		<option value="10" label="Ten"/>
		<value>4</value>
	</parameter>
	<parameter code="O_groups_methods" label="Group Breaks Method" display="false">
		<option value="QUANTILE" label="Quantile"/>
		<option value="EQUAL" label="Equal Interval"/>
		<value>QUANTILE</value>
	</parameter>
	<parameter code="O_aar_pop" label="Standard Population" display="true">
		<option value="0000" label="2000 U.S. Std. Population"/>
		<option value="1940" label="1940 U.S. Std. Million"/>
		<option value="1970" label="1970 U.S. Std. Million"/>
		<option value="2000" label="2000 U.S. Std. Million"/>
		<option value="1111" label="World Std. Million (WHO 2000-2025)"/>
		<option value="2222" label="World Std. Million (SEGI 1960)"/>
		<value>0000</value>
	</parameter>
	<parameter code="O_age" label="" display="false">
		<value>D158.V5</value>
	</parameter>
	<parameter code="O_rate_per" label="Calculate Rates Per" display="true">
		<option value="1000" label="1,000"/>
		<option value="10000" label="10,000"/>
		<option value="100000" label="100,000"/>
		<option value="1000000" label="1,000,000"/>
		<value>100000</value>
	</parameter>
	<parameter code="O_post_pops" label="Rate Options" display="true">
		<option value="false" label="Default intercensal populations for years 2001-2009 (except Infant Age Groups)"/>
		<option value="true" label="Archive postcensal populations for years 2001-2009 (except Infant Age Groups)"/>
		<value>false</value>
	</parameter>
	<parameter code="O_icd_selections" label="" display="false">
		<value>D158.V22,</value>
	</parameter>
	<parameter code="O_ucd" display="false">
		<value>D158.V22</value>
	</parameter>
	<parameter code="O_dates" display="false">
		<value>YEAR</value>
	</parameter>
	<parameter code="O_V1_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_aar" display="false">
		<value>aar_std</value>
	</parameter>
	<parameter code="O_javascript" display="false">
		<value>on</value>
	</parameter>
	<parameter code="O_V10_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_oc-sect1-request" display="false">
		<value>close</value>
	</parameter>
	<parameter code="O_urban" display="false">
		<value>D158.V19</value>
	</parameter>
	<parameter code="O_V2_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_title" display="false">
		<value></value>
	</parameter>
	<parameter code="O_V9_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V27_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_location" display="false">
		<value>D158.V9</value>
	</parameter>
	<parameter code="O_race" display="false">
		<value>D158.V42</value>
	</parameter>
	<parameter code="O_labels_opt" display="false">
		<value>disabled</value>
	</parameter>
	<parameter code="O_show_rank" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_groups" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_labels_quick" display="false">
		<value>disabled</value>
	</parameter>
</other-parameters>
<measure-selections-all>
	<measure code="D158.M1"/>
	<measure code="D158.M2"/>
	<measure code="D158.M3"/>
	<measure code="D158.M4"/>
</measure-selections-all>
<data-table show-all-labels="false">
<r><c l="2018"/><c v="48,344"/><c v="327,167,434"/><c v="14.777" a="c"><l v="(14.645 - 14.908)"/></c><c v="14.245" a="c"><l v="(14.115 - 14.375)"/></c></r>
<r><c l="2019"/><c v="47,511"/><c v="328,239,523"/><c v="14.474" a="c"><l v="(14.344 - 14.605)"/></c><c v="13.937" a="c"><l v="(13.809 - 14.066)"/></c></r>
<r><c l="2020"/><c v="45,979"/><c v="329,484,123"/><c v="13.955" a="c"><l v="(13.827 - 14.082)"/></c><c v="13.519" a="c"><l v="(13.393 - 13.646)"/></c></r>
<r><c l="2021"/><c v="48,183"/><c v="331,893,745"/><c v="14.518" a="c"><l v="(14.388 - 14.647)"/></c><c v="14.087" a="c"><l v="(13.959 - 14.216)"/></c></r>
<r><c l="2022"/><c v="49,476"/><c v="333,287,557"/><c v="14.845" a="c"><l v="(14.714 - 14.976)"/></c><c v="14.221" a="c"><l v="(14.093 - 14.350)"/></c></r>
<r><c l="2023"/><c v="49,316"/><c v="334,914,895"/><c v="14.725" a="c"><l v="(14.595 - 14.855)"/></c><c v="14.129" a="c"><l v="(14.002 - 14.257)"/></c></r>
<r><c l="2024 "/><c v="48,824"/><c v="340,110,988"/><c v="14.355" a="c"><l v="(14.228 - 14.483)"/></c><c v="13.732" a="c"><l v="(13.608 - 13.857)"/></c></r>
<r><c c="1"/><c dt="337,633"/><c dt="2,325,098,265"/><c dt="14.521" a="c"><l v="(14.472 - 14.570)"/></c><c dt="13.981" a="c"><l v="(13.932 - 14.029)"/></c></r>
</data-table>
<footnotes>
</footnotes>
<caveats>
<caveat><![CDATA[The populations used to calculate standard age-adjusted rates are documented here: <a href="/wonder/help/ucd-expanded.html#2000 Standard Population" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[The method used to calculate age-adjusted rates is documented here: <a href="/wonder/help/ucd-expanded.html#Age-Adjusted Rates" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[Deaths for persons of unknown age are included in counts and crude rates, but are not included 
				in age-adjusted rates.]]></caveat>
<caveat><![CDATA[The method used to calculate 95% confidence intervals is documented here: <a href="/wonder/help/ucd-expanded.html#Confidence-Intervals" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[The population figures for year 2024 are single-race estimates of the July 1 resident 
				population, from the Vintage 2024 postcensal series released by the Census Bureau on June 27, 2024.
				The 2024 series is based on the Modified Blended Base produced by the US Census Bureau in lieu of the
				April 1, 2020 decennial population count. The Modified Blended Base consists of the blend of Vintage 
				2020 postcensal population estimates for April 1, 2020, 2020 Demographic Analysis Estimates, and 2020 
				Census data from the internal Census Edited File (CEF).
			    The population figures for year 2023 are single-race estimates of the July 1 resident 
				population, from the Vintage 2023 postcensal series released by the Census Bureau on June 27, 2024.
				The 2023 series is based on the Modified Blended Base produced by the US Census Bureau in lieu of the
				April 1, 2020 decennial population count. The Modified Blended Base consists of the blend of Vintage 
				2020 postcensal population estimates for April 1, 2020, 2020 Demographic Analysis Estimates, and 2020 
				Census data from the internal Census Edited File (CEF).
			    The population figures for years 2022 are single-race estimates of the July 1 resident 
				population, from the Vintage 2022 postcensal series released by the Census Bureau on June 22, 2023.
				The 2022 series is based on the Modified Blended Base produced by the US Census Bureau in lieu of the
				April 1, 2020 decennial population count. The Modified Blended Base consists of the blend of Vintage 
				2020 postcensal population estimates for April 1, 2020, 2020 Demographic Analysis Estimates, and 2020 
				Census data from the internal Census Edited File (CEF).
				The population figures for years 2021  
				are single-race estimates of the July 1 resident population,  
			    based on the Blended Base produced by the US Census Bureau 
				in lieu of the April 1, 2020 decennial population count,
				from the Vintage 2021 postcensal series  
				released by the Census Bureau on June 30, 2022.
				The population figures for year 2020 are single-race estimates of the July 1 resident 
				population, from the Vintage 2020  postcensal series based on April 2010 Census, 
				released by the Census Bureau on July 27, 2021.  
				The population figures for year 2019 are single-race estimates of the July 1 resident population, 
				from the Vintage 2019 postcensal series based on April 2010 Census, 
				released by the Census Bureau on June 25, 2020. 
				The population figures for year 2018 are single-race estimates of the July 1 resident population, 
				from the Vintage 2018 postcensal series based on April 2010 Census,
				released by the Census Bureau on June 20, 2019.
				<a href="/wonder/help/ucd-expanded.html#Population Data" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[The population figures used in the calculation of death rates for the age group 
				'under 1 year' are the estimates of the resident population that is under one year of age. <a href="/wonder/help/ucd-expanded.html#Age Group" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[Connecticut population estimates for 2022 and later years are reported for 9 planning regions as county equivalent 
					areas, instead of the former 8 legacy counties in the Vintage 2022 postcensal series released by the Census Bureau
					on June 22, 2023, and in the Vintage 2023 postcensal series released by the Census Bureau on June 27, 2024.  
					Populations estimates for the former counties are not available for 2022 and later years. <a href="/wonder/help/ucd-expanded.html#Connecticut-2022" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[After the creation of the final 2023 dataset, North Carolina updated the cause of 
			death information for over 900 death certificates to include a cause of death code 
			indicating drug overdose (ICD-10 underlying cause-of-death codes: X40-X44, X60-X64, 
			X85, and Y10-Y14).  Jurisdictions can continue to update death certificates after the 
			closing of the mortality file.  As a result, users should consider that the actual
			death count for drug overdose deaths for North Carolina in 2023 is over 4,400 deaths,
			with a crude rate of approximately 41.0 per 100,000 population, and an age-adjusted
			rate of approximately 42.1 per 100,000 population. These deaths will not be updated 
			on the final mortality datasets.]]></caveat>
</caveats>
</response>
</page>
`;
