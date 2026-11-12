// A real CDC WONDER response, captured 2026-11-11 from
// https://wonder.cdc.gov/controller/datarequest/D176 (the provisional file)
// for the query: group by year, injury intent = suicide.
//
// TRIMMED, NOT EDITED, on the same terms as d158Response.ts. Kept because it
// is the only record of two things the app depends on and CDC does not
// document: how a provisional year is labelled ("2026 (provisional and
// partial)"), and the caveat that says how far the data runs ("Deaths
// occurring through ... as of ...").

export const D176_RESPONSE_XML = `<?xml version="1.0"?>
<page>
<platform>prod</platform>
<title>Provisional Mortality Statistics, 2018 through Last Week Results Form</title>
<default-map/>
<agreement-signed>true</agreement-signed>
<dataset code="D176" label="Provisional Mortality Statistics, 2018 through Last Week" family="MCD" validatorFamily="MORT" totals="true" vintage="October 31, 2026 as of November 8, 2026" suppress-counts="true" suppress-zeros="true" mortprov-titles="true" agreement-required="true">
	<caveat code="D176.C00">
		<text evaluate="false"><![CDATA[Totals and Percent of Total are disabled when data are grouped by a 113 or 130 Cause List 
				because both aggregate and detailed values are displayed in the table. Also be aware that charts and maps 
				containing both aggregate and detail data could be misleading.]]></text>
		<rule>wonder:mcd-totals-disable()</rule>
	</caveat>
	<caveat code="D176.C00a">
		<text evaluate="false"><![CDATA[Aggregate values for MCD 113 and 130 Groups may not be the sum of their member values because 
				a death record could contain more than one member of a larger aggregate. #MCD Aggregates#]]></text>
		<rule>wonder:mcd-mcd-groups()</rule>
	</caveat>
</dataset>
<response>
<request query-date="Nov 11, 2026 10:06:58 PM">
<variable-selections>
	<variable code="D176.V22" from-finder="false">
		<value code="2"/>
	</variable>
</variable-selections>
<byvariables>
	<variable code="D176.V1-level1"/>
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
		<value>false</value>
	</parameter>
	<parameter code="O_show_suppressed" label="Show Suppressed" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>false</value>
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
	<parameter code="O_aar_pop" label="Standard Population" display="false">
		<option value="0000" label="2000 U.S. Std. Population"/>
		<option value="1940" label="1940 U.S. Std. Million"/>
		<option value="1970" label="1970 U.S. Std. Million"/>
		<option value="2000" label="2000 U.S. Std. Million"/>
		<option value="1111" label="World Std. Million (WHO 2000-2025)"/>
		<option value="2222" label="World Std. Million (SEGI 1960)"/>
		<value>0000</value>
	</parameter>
	<parameter code="O_age" label="" display="false">
		<value>D176.V5</value>
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
		<value>D176.V22,D176.V13</value>
	</parameter>
	<parameter code="O_PR" label="" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_dates" display="false">
		<value>YEAR</value>
	</parameter>
	<parameter code="O_V80_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V77_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_MMWR" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_V10_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_oc-sect1-request" display="false">
		<value>close</value>
	</parameter>
	<parameter code="O_V2_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V25_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_title" display="false">
		<value></value>
	</parameter>
	<parameter code="O_V15_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_mcd" display="false">
		<value>D176.V13</value>
	</parameter>
	<parameter code="O_V27_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_ucd" display="false">
		<value>D176.V22</value>
	</parameter>
	<parameter code="O_V13_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_V1_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_aar" display="false">
		<value>aar_none</value>
	</parameter>
	<parameter code="O_javascript" display="false">
		<value>on</value>
	</parameter>
	<parameter code="O_urban" display="false">
		<value>D176.V19</value>
	</parameter>
	<parameter code="O_death_location" display="false">
		<value>D176.V79</value>
	</parameter>
	<parameter code="O_V79_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V9_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_location" display="false">
		<value>D176.V9</value>
	</parameter>
	<parameter code="O_death_urban" display="false">
		<value>D176.V89</value>
	</parameter>
	<parameter code="O_V16_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_V26_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_race" display="false">
		<value>D176.V42</value>
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
		<value>D176.V1-level1</value>
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
		<name>L_D176.V15</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>L_D176.V16</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>M_1</name>
		<value>D176.M1</value>
	</parameter>
	<parameter>
		<name>M_2</name>
		<value>D176.M2</value>
	</parameter>
	<parameter>
		<name>M_3</name>
		<value>D176.M3</value>
	</parameter>
	<parameter>
		<name>VM_D176.M6_D176.V10</name>
		<value></value>
	</parameter>
	<parameter>
		<name>VM_D176.M6_D176.V17</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>VM_D176.M6_D176.V1_S</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>VM_D176.M6_D176.V42</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>VM_D176.M6_D176.V7</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V1</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V10</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V100</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V11</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V12</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V13</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V13_AND</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V15</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V15_AND</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V16</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V16_AND</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V17</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V19</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V2</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V20</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V21</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V22</name>
		<value>2</value>
	</parameter>
	<parameter>
		<name>V_D176.V23</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V25</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V26</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V26_AND</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V27</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V4</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V42</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V43</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V44</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V5</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V51</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V52</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V6</name>
		<value>00</value>
	</parameter>
	<parameter>
		<name>V_D176.V7</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V77</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V79</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V80</name>
		<value></value>
	</parameter>
	<parameter>
		<name>V_D176.V81</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V89</name>
		<value>*All*</value>
	</parameter>
	<parameter>
		<name>V_D176.V9</name>
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
		<value>false</value>
	</parameter>
	<parameter code="O_show_suppressed" label="Show Suppressed" display="true">
		<option value="true" label="True"/>
		<option value="false" label="False"/>
		<option value="disabled" label="Disabled"/>
		<value>false</value>
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
	<parameter code="O_aar_pop" label="Standard Population" display="false">
		<option value="0000" label="2000 U.S. Std. Population"/>
		<option value="1940" label="1940 U.S. Std. Million"/>
		<option value="1970" label="1970 U.S. Std. Million"/>
		<option value="2000" label="2000 U.S. Std. Million"/>
		<option value="1111" label="World Std. Million (WHO 2000-2025)"/>
		<option value="2222" label="World Std. Million (SEGI 1960)"/>
		<value>0000</value>
	</parameter>
	<parameter code="O_age" label="" display="false">
		<value>D176.V5</value>
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
		<value>D176.V22,D176.V13</value>
	</parameter>
	<parameter code="O_PR" label="" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_dates" display="false">
		<value>YEAR</value>
	</parameter>
	<parameter code="O_V80_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V77_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_MMWR" display="false">
		<value>false</value>
	</parameter>
	<parameter code="O_V10_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_oc-sect1-request" display="false">
		<value>close</value>
	</parameter>
	<parameter code="O_V2_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V25_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_title" display="false">
		<value></value>
	</parameter>
	<parameter code="O_V15_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_mcd" display="false">
		<value>D176.V13</value>
	</parameter>
	<parameter code="O_V27_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_ucd" display="false">
		<value>D176.V22</value>
	</parameter>
	<parameter code="O_V13_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_V1_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_aar" display="false">
		<value>aar_none</value>
	</parameter>
	<parameter code="O_javascript" display="false">
		<value>on</value>
	</parameter>
	<parameter code="O_urban" display="false">
		<value>D176.V19</value>
	</parameter>
	<parameter code="O_death_location" display="false">
		<value>D176.V79</value>
	</parameter>
	<parameter code="O_V79_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_V9_fmode" display="false">
		<value>freg</value>
	</parameter>
	<parameter code="O_location" display="false">
		<value>D176.V9</value>
	</parameter>
	<parameter code="O_death_urban" display="false">
		<value>D176.V89</value>
	</parameter>
	<parameter code="O_V16_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_V26_fmode" display="false">
		<value>fadv</value>
	</parameter>
	<parameter code="O_race" display="false">
		<value>D176.V42</value>
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
	<measure code="D176.M1"/>
	<measure code="D176.M2"/>
	<measure code="D176.M3"/>
</measure-selections-all>
<data-table show-all-labels="false">
<r><c l="2018"/><c v="48,344"/><c v="327,167,434"/><c v="14.777" a="c"><l v="(14.645 - 14.908)"/></c></r>
<r><c l="2019"/><c v="47,511"/><c v="328,239,523"/><c v="14.474" a="c"><l v="(14.344 - 14.605)"/></c></r>
<r><c l="2020"/><c v="45,979"/><c v="329,484,123"/><c v="13.955" a="c"><l v="(13.827 - 14.082)"/></c></r>
<r><c l="2021"/><c v="48,183"/><c v="331,893,745"/><c v="14.518" a="c"><l v="(14.388 - 14.647)"/></c></r>
<r><c l="2022"/><c v="49,476"/><c v="333,287,557"/><c v="14.845" a="c"><l v="(14.714 - 14.976)"/></c></r>
<r><c l="2023"/><c v="49,316"/><c v="334,914,895"/><c v="14.725" a="c"><l v="(14.595 - 14.855)"/></c></r>
<r><c l="2024"/><c v="48,824"/><c v="340,110,988"/><c v="14.355" a="c"><l v="(14.228 - 14.483)"/></c></r>
<r><c l="2025 (provisional)"/><c v="49,094"/><c v="340,110,988"/><c v="14.435" a="c"><l v="(14.307 - 14.562)"/></c></r>
<r><c l="2026 (provisional and partial)"/><c v="16,820"/><c v="340,110,988"/><c v="4.945" a="c"><l v="(4.871 - 5.020)"/></c></r>
<r><c c="1"/><c dt="403,547"/><c dt="3,005,320,241"/><c dt="13.428" a="c"><l v="(13.386 - 13.469)"/></c></r>
</data-table>
<footnotes>
</footnotes>
<caveats>
<caveat><![CDATA[The method used to calculate 95% confidence intervals is documented here: <a href="/wonder/help/mcd-provisional.html#Confidence-Intervals" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[The population estimates for years 2022 - 2026 are from separate series of estimates based on the Modified Blended Base 
        produced by the US Census Bureau in lieu of the April 1, 2020 decennial population count. The Modified Blended Base consists 
        of the blend of Vintage 2020 postcensal population estimates for April 1, 2020, 2020 Demographic Analysis Estimates, and 2020 
        Census data from the internal Census Edited File (CEF). Each subsequent series of estimates adjusts the methodology. 

        The population figures for years 2024 and later are single-race estimates of the July 1 resident population, from the Vintage 2024 postcensal series released by the Census Bureau on June 26, 2025. 
  
        The population figures for year 2023 are single-race estimates of the July 1 resident population, from the Vintage 2023 
        postcensal series released by the Census Bureau on June 27, 2024. 
 
        The population figures for year 2022 are single-race estimates of the July 1 resident population, from the Vintage 2022
        postcensal series released by the Census Bureau on June 22, 2023. 
 
        The population figures for year 2021 are single-race estimates of the July 1 resident population, based on the Blended
        Base produced by the US Census Bureau in lieu of the April 1, 2020 decennial population count, from the Vintage 2021 postcensal 
        series released by the Census Bureau on June 30, 2022. 
 
        The population figures for year 2020 are single-race estimates of the July 1 resident population, from the Vintage 2020 
        postcensal series based on April 2010 Census, released by the Census Bureau on July 27, 2021. 
 
        The population figures for year 2019 are single-race estimates of the July 1 resident population, from the Vintage 2019 
        postcensal series based on April 2010 Census, released by the Census Bureau on June 25, 2020. 
				
				The population figures for year 2018 are single-race estimates of the July 1 resident population, 
				from the Vintage 2018 postcensal series based on April 2010 Census,
				released by the Census Bureau on June 20, 2019.

        The July 1, 2020 annual Puerto Rico municipio resident population estimates by age and sex from the Census Bureau's "Vintage 2020" postcensal series released by the Census Bureau on June 17, 2021 are denominators for calculating rates for deaths of Puerto Rico residents in year 2020.  

        The July 1, 2021 annual Puerto Rico municipio resident population estimates by age and sex from the Census Bureau's "Vintage 2021" postcensal series released by the Census Bureau on June 30, 2022 are denominators for calculating rates for deaths of Puerto Rico residents in year 2021.

       The July 1, 2022 annual Puerto Rico municipio resident population estimates by age and sex from the Census Bureau's "Vintage 2022" postcensal series released by the Census Bureau on June 22, 2023 are denominators for calculating rates for deaths of Puerto Rico residents in year 2022.

       The July 1, 2023 annual Puerto Rico municipio resident population estimates by age and sex from the Census Bureau's "Vintage 2023" postcensal series released by the Census Bureau on June 27, 2024 are denominators for calculating rates for deaths of Puerto Rico residents in year 2023, and for the provisional mortality updates for deaths of Puerto Rico residents in year 2024 and later.

       Population denominators are also updated annually for prior vintages, therefore death rates may differ slightly from the previously published numbers in NVSR Deaths: Final Data for 2020-2022.
        <a href="/wonder/help/mcd-provisional.html#Dates-of-Population-Updates" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[The population figures used in the calculation of death rates for the age group 'under 1 year' are 
				the estimates of the resident population that is under one year of age. <a href="/wonder/help/mcd-provisional.html#Age Group" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[Connecticut population estimates for 2022 and later years are reported for 9 planning regions 
				as county equivalent areas, instead of the former 8 legacy counties in the 
				Vintage 2022 postcensal series released by the Census Bureau on June 22, 2023, 
				and in the Vintage 2023 postcensal series released by the 
				Census Bureau on June 27, 2024. 
				Populations estimates for the former counties are not available for 
				2022 and later years. <a href="/wonder/help/mcd-provisional.html#Connecticut-2022" target="WONDER_Help" onclick="setfocus('WONDER_Help')">More information.</a>]]></caveat>
<caveat><![CDATA[After the creation of the final 2023 dataset, North Carolina updated the cause of 
        death information for over 900 death certificates to include a cause of death code 
        indicating drug overdose (ICD-10 underlying cause-of-death codes: X40-X44, X60-X64, 
        X85, and Y10-Y14).  Jurisdictions can continue to update death certificates after the 
        closing of the mortality file.  As a result, users should consider that the actual
        death count for drug overdose deaths for North Carolina in 2023 is over 4,400 deaths,
        with a crude rate of approximately 41.0 per 100,000 population, and an age-adjusted
        rate of approximately 42.1 per 100,000 population. These deaths will not be updated 
        on the final mortality datasets.]]></caveat>
<caveat><![CDATA[Deaths of US and Puerto Rico residents are reported here. US totals include deaths for 
       US residents that died in the US.  Puerto Rico death totals include only deaths for 
       Puerto Rican residents that died in Puerto Rico. The number of deaths reported on 
       CDC WONDER may differ from other reports due to the exclusion of deaths of persons
        residing outside the US and Puerto Rico.]]></caveat>
<caveat><![CDATA[Deaths occurring through October 31, 2026 as of November 8, 2026.]]></caveat>
</caveats>
</response>
</page>
`;
